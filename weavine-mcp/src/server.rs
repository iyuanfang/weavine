use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ContentBlock, Implementation, JsonObject,
        ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    ErrorData as RmcpError, RoleServer,
};

use crate::client::WeavineClient;
use crate::config::{Config, Tier};
use crate::error::{McpError, McpResult};

#[derive(Clone)]
pub struct WeavineMcpServer {
    pub(crate) client: WeavineClient,
    pub(crate) cfg: Arc<Config>,
}

impl WeavineMcpServer {
    pub fn new(cfg: Arc<Config>) -> anyhow::Result<Self> {
        let client = WeavineClient::new(cfg.clone())?;
        Ok(Self { client, cfg })
    }

    /// Parse MCP arguments into a typed request body and validate required
    /// non-empty string fields (`*_id`, `*_ids` arrays, common scalar ids).
    /// Returns [`McpError::BadInput`] with a clear message on shape or
    /// validation failure.
    fn parse<T: serde::de::DeserializeOwned>(
        args: Option<JsonObject>,
    ) -> McpResult<T> {
        let v = Self::to_value(args);
        let parsed: T = serde_json::from_value(v.clone())
            .map_err(|e| McpError::BadInput(format!("invalid arguments: {e}")))?;
        Self::validate_ids(&v)?;
        Ok(parsed)
    }

    fn to_value(args: Option<JsonObject>) -> serde_json::Value {
        match args {
            Some(m) => serde_json::Value::Object(m),
            None => serde_json::Value::Object(serde_json::Map::new()),
        }
    }

    /// Reject obviously-bad identifiers: empty/whitespace strings, empty
    /// arrays of UUIDs. Looks for any field whose name ends in `_id` or
    /// whose name is exactly `id`, plus `*_ids` arrays. Does **not** check
    /// UUID format — that's a server-side concern.
    fn validate_ids(v: &serde_json::Value) -> McpResult<()> {
        let Some(obj) = v.as_object() else {
            return Ok(());
        };
        for (k, val) in obj {
            let lower = k.to_ascii_lowercase();
            let is_id_field = lower == "id"
                || lower.ends_with("_id")
                || lower.ends_with("_ids");
            if !is_id_field {
                continue;
            }
            match val {
                serde_json::Value::String(s) if s.trim().is_empty() => {
                    return Err(McpError::BadInput(format!(
                        "field `{k}` must be a non-empty string"
                    )));
                }
                serde_json::Value::Array(a) if a.is_empty() => {
                    return Err(McpError::BadInput(format!(
                        "field `{k}` must contain at least one id"
                    )));
                }
                serde_json::Value::Array(a) => {
                    for (i, item) in a.iter().enumerate() {
                        if let serde_json::Value::String(s) = item {
                            if s.trim().is_empty() {
                                return Err(McpError::BadInput(format!(
                                    "field `{k}[{i}]` must be a non-empty string"
                                )));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn empty_schema() -> Arc<JsonObject> {
    let mut m = JsonObject::new();
    m.insert("type".to_string(), serde_json::Value::String("object".to_string()));
    m.insert(
        "properties".to_string(),
        serde_json::Value::Object(JsonObject::new()),
    );
    Arc::new(m)
}

tokio::task_local! {
    pub static API_KEY: String;
}

#[macro_export]
macro_rules! api {
    () => {
        $crate::server::API_KEY.get().as_str()
    };
}

fn extract_api_key(context: &RequestContext<RoleServer>) -> McpResult<String> {
    let parts = context
        .extensions
        .get::<http::request::Parts>()
        .ok_or_else(|| McpError::Auth("no http request parts in extensions".into()))?;
    let auth = parts
        .headers
        .get(http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| McpError::Auth("missing Authorization header".into()))?;
    let key = auth
        .strip_prefix("Bearer ")
        .or_else(|| auth.strip_prefix("bearer "))
        .unwrap_or(auth)
        .trim()
        .to_string();
    if key.is_empty() {
        return Err(McpError::Auth("empty api key".into()));
    }
    if !key.starts_with("wvk_") {
        return Err(McpError::Auth("api key must start with wvk_".into()));
    }
    Ok(key)
}

fn schema_of<T: schemars::JsonSchema>() -> Arc<JsonObject> {
    let mut generator = schemars::r#gen::SchemaGenerator::default();
    let schema = T::json_schema(&mut generator);
    match serde_json::to_value(schema).ok() {
        Some(serde_json::Value::Object(m)) => Arc::new(m),
        _ => empty_schema(),
    }
}

fn tool(name: &'static str, description: &'static str, schema: Arc<JsonObject>) -> Tool {
    Tool::new(name, description, schema)
}

fn tier1_tools() -> Vec<Tool> {
    use crate::tools::{action, contact, event, note, project, quick, reminder};
    let mut t = Vec::with_capacity(40);
    t.push(tool("list_contacts", "List contacts with optional filters.", schema_of::<contact::ListContactsQuery>()));
    t.push(tool("get_contact", "Get contact by id.", schema_of::<contact::ContactId>()));
    t.push(tool("create_contact", "Create a contact.", schema_of::<contact::CreateContactBody>()));
    t.push(tool("update_contact", "Update a contact. Input: {id, fields: {...}}.", schema_of::<contact::UpdateContactBody>()));
    t.push(tool("delete_contact", "Delete a contact by id.", schema_of::<contact::ContactId>()));
    t.push(tool("upcoming_events", "List upcoming events within the next N days.", empty_schema()));
    t.push(tool("list_events", "List events with filters.", schema_of::<event::ListEventsQuery>()));
    t.push(tool("get_event", "Get event by id.", schema_of::<event::EventId>()));
    t.push(tool("create_event", "Create an event.", schema_of::<event::CreateEventBody>()));
    t.push(tool("update_event", "Update an event. Input: {id, fields: {...}}.", schema_of::<event::UpdateEventBody>()));
    t.push(tool("delete_event", "Delete an event by id.", schema_of::<event::EventId>()));
    t.push(tool("list_actions", "List action items with optional filters.", schema_of::<action::ListActionsQuery>()));
    t.push(tool("get_action", "Get an action by id.", schema_of::<action::ActionId>()));
    t.push(tool("create_action", "Create an action item.", schema_of::<action::CreateActionBody>()));
    t.push(tool("update_action", "Update an action. Input: {id, fields: {...}}.", schema_of::<action::UpdateActionBody>()));
    t.push(tool("delete_action", "Delete an action by id.", schema_of::<action::ActionId>()));
    t.push(tool("list_projects", "List projects.", schema_of::<project::ListProjectsQuery>()));
    t.push(tool("get_project", "Get project by id.", schema_of::<project::ProjectId>()));
    t.push(tool("create_project", "Create a project.", schema_of::<project::CreateProjectBody>()));
    t.push(tool("update_project", "Update a project. Input: {id, fields: {...}}.", schema_of::<project::UpdateProjectBody>()));
    t.push(tool("delete_project", "Delete a project by id.", schema_of::<project::ProjectId>()));
    t.push(tool("list_project_contacts", "List contacts on a project. Input: {id}.", schema_of::<project::ProjectId>()));
    t.push(tool("add_project_contact", "Add a contact to a project.", schema_of::<project::ProjectContactIds>()));
    t.push(tool("remove_project_contact", "Remove a contact from a project.", schema_of::<project::ProjectContactIds>()));
    t.push(tool("list_reminders", "List reminders with optional filters.", schema_of::<reminder::ListRemindersQuery>()));
    t.push(tool("get_reminder", "Get reminder by id.", schema_of::<reminder::ReminderId>()));
    t.push(tool("create_reminder", "Create a reminder.", schema_of::<reminder::CreateReminderBody>()));
    t.push(tool("update_reminder", "Update a reminder. Input: {id, fields: {...}}.", schema_of::<reminder::UpdateReminderBody>()));
    t.push(tool("delete_reminder", "Delete a reminder by id.", schema_of::<reminder::ReminderId>()));
    t.push(tool("list_notes", "List notes with optional limit + cursor.", schema_of::<note::ListNotesQuery>()));
    t.push(tool("get_note", "Get note by id.", schema_of::<note::NoteId>()));
    t.push(tool("create_note", "Create a note with optional entity links.", schema_of::<note::CreateNoteBody>()));
    t.push(tool("update_note", "Update a note. Input: {id, fields: {...}}.", schema_of::<note::UpdateNoteBody>()));
    t.push(tool("delete_note", "Delete a note by id.", schema_of::<note::NoteId>()));
    t.push(tool("list_note_backlinks", "Notes that link to a given entity (entity -> notes).", schema_of::<note::NoteBacklinksQuery>()));
    t.push(tool("list_note_entity_links", "Entities a note links to (note -> entities).", schema_of::<note::NoteId>()));
    t.push(tool("quick_parse", "Parse free-form text into a structured QuickItem.", schema_of::<quick::QuickParseBody>()));
    t
}

fn tier2_tools() -> Vec<Tool> {
    use crate::tools::{auth_jwt, diagnostic, interaction, search, setting, sync, tag};
    let mut t = Vec::with_capacity(28);
    t.push(tool("auth_register", "Register a new account. No API key needed.", schema_of::<auth_jwt::AuthRegisterInput>()));
    t.push(tool("auth_login", "Login by email + password. No API key needed.", schema_of::<auth_jwt::AuthLoginInput>()));
    t.push(tool("auth_logout", "Logout the current session.", empty_schema()));
    t.push(tool("diagnostic_user", "Server-side diagnostic of the current user.", schema_of::<diagnostic::DiagnosticUserInput>()));
    t.push(tool("diagnostic_startup", "Server startup diagnostic — db connectivity, sync status, counts.", empty_schema()));
    t.push(tool("list_tags", "List tags with optional filter.", schema_of::<tag::ListTagsQuery>()));
    t.push(tool("create_tag", "Create a tag.", schema_of::<tag::CreateTagBody>()));
    t.push(tool("update_tag", "Update a tag. Input: {id, fields: {...}}.", schema_of::<tag::UpdateTagBody>()));
    t.push(tool("delete_tag", "Delete a tag by id.", schema_of::<tag::TagId>()));
    t.push(tool("list_interactions", "List interactions with filters.", schema_of::<interaction::ListInteractionsQuery>()));
    t.push(tool("get_interaction", "Get interaction by id.", schema_of::<interaction::InteractionId>()));
    t.push(tool("create_interaction", "Create an interaction.", schema_of::<interaction::CreateInteractionBody>()));
    t.push(tool("update_interaction", "Update an interaction. Input: {id, fields: {...}}.", schema_of::<interaction::UpdateInteractionBody>()));
    t.push(tool("delete_interaction", "Delete an interaction by id.", schema_of::<interaction::InteractionId>()));
    t.push(tool("list_settings", "List current-user settings.", empty_schema()));
    t.push(tool("upsert_setting", "Upsert a setting.", schema_of::<setting::SettingUpsertInput>()));
    t.push(tool("delete_setting", "Delete a setting by key.", schema_of::<setting::SettingDeleteInput>()));
    t.push(tool("search", "Cross-entity search.", schema_of::<search::SearchQuery>()));
    t.push(tool("sync_manifest", "Get sync manifest.", schema_of::<sync::SyncManifestInput>()));
    t.push(tool("sync_pull", "Pull sync changes since cursor.", schema_of::<sync::SyncPullInput>()));
    t
}

impl ServerHandler for WeavineMcpServer {
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, RmcpError> {
        let args = request.arguments;
        let name = request.name.as_ref();
        let api_key = extract_api_key(&context)?;
        let v: serde_json::Value = API_KEY
            .scope(api_key, async move {
                self.dispatch_tool(name, args).await
            })
            .await?;
        let content = ContentBlock::json(v).map_err(|e| RmcpError::internal_error(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![content]))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, RmcpError> {
        let mut tools = tier1_tools();
        if matches!(self.cfg.tier, Tier::Full) {
            tools.extend(tier2_tools());
        }
        Ok(ListToolsResult {
            meta: None,
            next_cursor: None,
            tools,
        })
    }

    fn get_info(&self) -> ServerInfo {
        let tier = self.cfg.tier.clone();
        let caps = ServerCapabilities::builder().enable_tools().build();
        ServerInfo::new(caps)
            .with_server_info(Implementation::new(
                "weavine-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(match tier {
                Tier::Default => "weavine-mcp (Tier 1): contacts, events, actions, projects, reminders, notes, quick-parse. Set WEAVINE_MCP_TIER=full for additional resources.".to_string(),
                Tier::Full => "weavine-mcp (Tier 2 / full): full access.".to_string(),
            })
    }
}

impl WeavineMcpServer {
    async fn dispatch_tool(
        &self,
        name: &str,
        args: Option<JsonObject>,
    ) -> McpResult<serde_json::Value> {
        Ok(match name {
            "list_contacts" => {
                let input: crate::tools::contact::ListContactsQuery = Self::parse(args)?;
                self.list_contacts(input).await?
            }
            "get_contact" => {
                let input: crate::tools::contact::ContactId = Self::parse(args)?;
                self.get_contact(input).await?
            }
            "create_contact" => {
                let input: crate::tools::contact::CreateContactBody = Self::parse(args)?;
                self.create_contact(input).await?
            }
            "update_contact" => {
                let input: crate::tools::contact::UpdateContactBody = Self::parse(args)?;
                self.update_contact(input).await?
            }
            "delete_contact" => {
                let input: crate::tools::contact::ContactId = Self::parse(args)?;
                self.delete_contact(input).await?
            }
            "upcoming_events" => self.upcoming_events().await?,
            "list_events" => {
                let input: crate::tools::event::ListEventsQuery = Self::parse(args)?;
                self.list_events(input).await?
            }
            "get_event" => {
                let input: crate::tools::event::EventId = Self::parse(args)?;
                self.get_event(input).await?
            }
            "create_event" => {
                let input: crate::tools::event::CreateEventBody = Self::parse(args)?;
                self.create_event(input).await?
            }
            "update_event" => {
                let input: crate::tools::event::UpdateEventBody = Self::parse(args)?;
                self.update_event(input).await?
            }
            "delete_event" => {
                let input: crate::tools::event::EventId = Self::parse(args)?;
                self.delete_event(input).await?
            }
            "list_actions" => {
                let input: crate::tools::action::ListActionsQuery = Self::parse(args)?;
                self.list_actions(input).await?
            }
            "get_action" => {
                let input: crate::tools::action::ActionId = Self::parse(args)?;
                self.get_action(input).await?
            }
            "create_action" => {
                let input: crate::tools::action::CreateActionBody = Self::parse(args)?;
                self.create_action(input).await?
            }
            "update_action" => {
                let input: crate::tools::action::UpdateActionBody = Self::parse(args)?;
                self.update_action(input).await?
            }
            "delete_action" => {
                let input: crate::tools::action::ActionId = Self::parse(args)?;
                self.delete_action(input).await?
            }
            "list_projects" => {
                let input: crate::tools::project::ListProjectsQuery = Self::parse(args)?;
                self.list_projects(input).await?
            }
            "get_project" => {
                let input: crate::tools::project::ProjectId = Self::parse(args)?;
                self.get_project(input).await?
            }
            "create_project" => {
                let input: crate::tools::project::CreateProjectBody = Self::parse(args)?;
                self.create_project(input).await?
            }
            "update_project" => {
                let input: crate::tools::project::UpdateProjectBody = Self::parse(args)?;
                self.update_project(input).await?
            }
            "delete_project" => {
                let input: crate::tools::project::ProjectId = Self::parse(args)?;
                self.delete_project(input).await?
            }
            "list_project_contacts" => {
                let input: crate::tools::project::ProjectId = Self::parse(args)?;
                self.list_project_contacts(input).await?
            }
            "add_project_contact" => {
                let input: crate::tools::project::ProjectContactIds = Self::parse(args)?;
                self.add_project_contact(input).await?
            }
            "remove_project_contact" => {
                let input: crate::tools::project::ProjectContactIds = Self::parse(args)?;
                self.remove_project_contact(input).await?
            }
            "list_reminders" => {
                let input: crate::tools::reminder::ListRemindersQuery = Self::parse(args)?;
                self.list_reminders(input).await?
            }
            "get_reminder" => {
                let input: crate::tools::reminder::ReminderId = Self::parse(args)?;
                self.get_reminder(input).await?
            }
            "create_reminder" => {
                let input: crate::tools::reminder::CreateReminderBody = Self::parse(args)?;
                self.create_reminder(input).await?
            }
            "update_reminder" => {
                let input: crate::tools::reminder::UpdateReminderBody = Self::parse(args)?;
                self.update_reminder(input).await?
            }
            "delete_reminder" => {
                let input: crate::tools::reminder::ReminderId = Self::parse(args)?;
                self.delete_reminder(input).await?
            }
            "list_notes" => {
                let input: crate::tools::note::ListNotesQuery = Self::parse(args)?;
                self.list_notes(input).await?
            }
            "get_note" => {
                let input: crate::tools::note::NoteId = Self::parse(args)?;
                self.get_note(input).await?
            }
            "create_note" => {
                let input: crate::tools::note::CreateNoteBody = Self::parse(args)?;
                self.create_note(input).await?
            }
            "update_note" => {
                let input: crate::tools::note::UpdateNoteBody = Self::parse(args)?;
                self.update_note(input).await?
            }
            "delete_note" => {
                let input: crate::tools::note::NoteId = Self::parse(args)?;
                self.delete_note(input).await?
            }
            "list_note_backlinks" => {
                let input: crate::tools::note::NoteBacklinksQuery = Self::parse(args)?;
                self.list_note_backlinks(input).await?
            }
            "list_note_entity_links" => {
                let input: crate::tools::note::NoteId = Self::parse(args)?;
                self.list_note_entity_links(input).await?
            }
            "quick_parse" => {
                let input: crate::tools::quick::QuickParseBody = Self::parse(args)?;
                self.quick_parse(input).await?
            }
            "auth_register" => {
                let input: crate::tools::auth_jwt::AuthRegisterInput = Self::parse(args)?;
                self.auth_register(input).await?
            }
            "auth_login" => {
                let input: crate::tools::auth_jwt::AuthLoginInput = Self::parse(args)?;
                self.auth_login(input).await?
            }
            "auth_logout" => self.auth_logout().await?,
            "diagnostic_user" => {
                let input: crate::tools::diagnostic::DiagnosticUserInput = Self::parse(args)?;
                self.diagnostic_user(input).await?
            }
            "diagnostic_startup" => self.diagnostic_startup().await?,
            "list_tags" => {
                let input: crate::tools::tag::ListTagsQuery = Self::parse(args)?;
                self.list_tags(input).await?
            }
            "create_tag" => {
                let input: crate::tools::tag::CreateTagBody = Self::parse(args)?;
                self.create_tag(input).await?
            }
            "update_tag" => {
                let input: crate::tools::tag::UpdateTagBody = Self::parse(args)?;
                self.update_tag(input).await?
            }
            "delete_tag" => {
                let input: crate::tools::tag::TagId = Self::parse(args)?;
                self.delete_tag(input).await?
            }
            "list_interactions" => {
                let input: crate::tools::interaction::ListInteractionsQuery = Self::parse(args)?;
                self.list_interactions(input).await?
            }
            "get_interaction" => {
                let input: crate::tools::interaction::InteractionId = Self::parse(args)?;
                self.get_interaction(input).await?
            }
            "create_interaction" => {
                let input: crate::tools::interaction::CreateInteractionBody = Self::parse(args)?;
                self.create_interaction(input).await?
            }
            "update_interaction" => {
                let input: crate::tools::interaction::UpdateInteractionBody = Self::parse(args)?;
                self.update_interaction(input).await?
            }
            "delete_interaction" => {
                let input: crate::tools::interaction::InteractionId = Self::parse(args)?;
                self.delete_interaction(input).await?
            }
            "list_settings" => self.list_settings().await?,
            "upsert_setting" => {
                let input: crate::tools::setting::SettingUpsertInput = Self::parse(args)?;
                self.upsert_setting(input).await?
            }
            "delete_setting" => {
                let input: crate::tools::setting::SettingDeleteInput = Self::parse(args)?;
                self.delete_setting(input).await?
            }
            "search" => {
                let input: crate::tools::search::SearchQuery = Self::parse(args)?;
                self.search(input).await?
            }
            "sync_manifest" => {
                let input: crate::tools::sync::SyncManifestInput = Self::parse(args)?;
                self.sync_manifest(input).await?
            }
            "sync_pull" => {
                let input: crate::tools::sync::SyncPullInput = Self::parse(args)?;
                self.sync_pull(input).await?
            }
            other => {
                return Err(McpError::BadInput(format!("unknown tool: {other}")));
            }
        })
    }
}
