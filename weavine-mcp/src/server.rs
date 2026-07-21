use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParam, CallToolResult, Content, Implementation, JsonObject, ListToolsResult,
        PaginatedRequestParam, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    Error as RmcpError, RoleServer,
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

    fn parse<T: serde::de::DeserializeOwned>(
        args: Option<JsonObject>,
    ) -> McpResult<T> {
        serde_json::from_value(Self::to_value(args.clone()))
            .map_err(|e| McpError::BadInput(e.to_string()))
    }

    fn to_value(args: Option<JsonObject>) -> serde_json::Value {
        match args {
            Some(m) => serde_json::Value::Object(m),
            None => serde_json::Value::Object(serde_json::Map::new()),
        }
    }
}

fn empty_schema() -> Arc<JsonObject> {
    Arc::new(JsonObject::new())
}

fn tool(name: &'static str, description: &'static str) -> Tool {
    Tool::new(name, description, empty_schema())
}

fn tier1_tools() -> Vec<Tool> {
    let mut t = Vec::with_capacity(32);
    t.push(tool("list_api_keys", "List active (non-revoked) API keys for the current user."));
    t.push(tool("create_api_key", "Create a new API key. Input: {name}. Returns plaintext key exactly once."));
    t.push(tool("revoke_api_key", "Revoke an API key. Input: {id}."));
    t.push(tool("list_contacts", "List contacts. Input (all optional): {q, tag, limit, offset, sort}."));
    t.push(tool("get_contact", "Get contact by id. Input: {id}."));
    t.push(tool("create_contact", "Create a contact. Input body: contact fields."));
    t.push(tool("update_contact", "Update a contact. Input: {id, ...fields}."));
    t.push(tool("delete_contact", "Delete a contact. Input: {id}."));
    t.push(tool("upcoming_events", "List upcoming events. Input (optional): {days}."));
    t.push(tool("list_events", "List events. Input (optional): {contact_id, project_id, limit, offset}."));
    t.push(tool("get_event", "Get event by id. Input: {id}."));
    t.push(tool("create_event", "Create an event. Input body: event fields."));
    t.push(tool("update_event", "Update an event. Input: {id, ...fields}."));
    t.push(tool("delete_event", "Delete an event. Input: {id}."));
    t.push(tool("list_actions", "List actions. Input (optional): {status, contact_id, project_id, limit, offset}."));
    t.push(tool("get_action", "Get action by id. Input: {id}."));
    t.push(tool("create_action", "Create an action. Input: {title, due?, contact_id?, project_id?}."));
    t.push(tool("update_action", "Update an action. Input: {id, ...fields}."));
    t.push(tool("delete_action", "Delete an action. Input: {id}."));
    t.push(tool("list_projects", "List projects. Input (optional): {limit, offset}."));
    t.push(tool("get_project", "Get project by id. Input: {id}."));
    t.push(tool("create_project", "Create a project. Input body: project fields."));
    t.push(tool("update_project", "Update a project. Input: {id, ...fields}."));
    t.push(tool("delete_project", "Delete a project. Input: {id}."));
    t.push(tool("list_project_contacts", "List contacts on a project. Input: {id}."));
    t.push(tool("add_project_contact", "Add a contact to a project. Input: {project_id, contact_id}."));
    t.push(tool("remove_project_contact", "Remove a contact from a project. Input: {project_id, contact_id}."));
    t.push(tool("list_reminders", "List reminders. Input (optional): {contact_id, event_id, include_dismissed, limit}."));
    t.push(tool("get_reminder", "Get reminder by id. Input: {id}."));
    t.push(tool("create_reminder", "Create a reminder. Input: {contact_id or event_id, trigger_at (RFC3339), kind}."));
    t.push(tool("update_reminder", "Update a reminder. Input: {id, ...fields}."));
    t.push(tool("delete_reminder", "Delete a reminder. Input: {id}."));
    t
}

fn tier2_tools() -> Vec<Tool> {
    let mut t = Vec::with_capacity(28);
    t.push(tool("auth_register", "Register a new account. Input: {email, password}. No API key needed."));
    t.push(tool("auth_login", "Login by email + password. Input: {email, password}. No API key needed."));
    t.push(tool("auth_logout", "Logout the current session. No API key needed."));
    t.push(tool("diagnostic_user", "Server-side diagnostic of the current user."));
    t.push(tool("diagnostic_startup", "Server startup diagnostic — db connectivity, sync status, counts."));
    t.push(tool("list_tags", "List tags. Input (optional): {q, limit}."));
    t.push(tool("create_tag", "Create a tag. Input body: {name, color?, parent_id?}."));
    t.push(tool("update_tag", "Update a tag. Input: {id, ...fields}."));
    t.push(tool("delete_tag", "Delete a tag. Input: {id}."));
    t.push(tool("list_interactions", "List interactions. Input (optional): {contact_id, event_id, kind, limit, offset}."));
    t.push(tool("get_interaction", "Get interaction by id. Input: {id}."));
    t.push(tool("create_interaction", "Create an interaction. Input body: {contact_id?, event_id?, kind, ...}."));
    t.push(tool("update_interaction", "Update an interaction. Input: {id, ...fields}."));
    t.push(tool("delete_interaction", "Delete an interaction. Input: {id}."));
    t.push(tool("archive_summary", "Archive summary across entities."));
    t.push(tool("archive_counts", "Per-entity archive counts."));
    t.push(tool("archive_list", "List archived items. Input (optional): {entity, limit}."));
    t.push(tool("archive_unarchive_one", "Unarchive one item. Input: {entity, id}."));
    t.push(tool("archive_bulk_unarchive", "Bulk unarchive. Input: {entity, ids}."));
    t.push(tool("list_settings", "List current-user settings."));
    t.push(tool("upsert_setting", "Upsert a setting. Input: {key, value}."));
    t.push(tool("delete_setting", "Delete a setting. Input: {key}."));
    t.push(tool("search", "Cross-entity search. Input: {q, entities?, limit?}."));
    t.push(tool("sync_manifest", "Get sync manifest. Input (optional): {device_id}."));
    t.push(tool("sync_push", "Push sync changes. Input: {device_id, changes}."));
    t.push(tool("sync_pull", "Pull sync changes since cursor. Input: {device_id, since?}."));
    t
}

impl ServerHandler for WeavineMcpServer {
    async fn call_tool(
        &self,
        request: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, RmcpError> {
        let args = request.arguments;
        let name = request.name.as_ref();
        let v: serde_json::Value = match name {
            "list_api_keys" => self.list_api_keys().await?,
            "create_api_key" => {
                let input: crate::tools::api_key::CreateApiKeyInput = Self::parse(args)?;
                self.create_api_key(input).await?
            }
            "revoke_api_key" => {
                let input: crate::tools::api_key::ApiKeyId = Self::parse(args)?;
                self.revoke_api_key(input).await?
            }
            "list_contacts" => {
                let input: crate::tools::contact::ListContactsQuery = Self::parse(args)?;
                self.list_contacts(input).await?
            }
            "get_contact" => {
                let input: crate::tools::contact::ContactId = Self::parse(args)?;
                self.get_contact(input).await?
            }
            "create_contact" => self.create_contact(Self::to_value(args)).await?,
            "update_contact" => self.update_contact(Self::to_value(args)).await?,
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
            "create_event" => self.create_event(Self::to_value(args)).await?,
            "update_event" => self.update_event(Self::to_value(args)).await?,
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
            "create_action" => self.create_action(Self::to_value(args)).await?,
            "update_action" => self.update_action(Self::to_value(args)).await?,
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
            "create_project" => self.create_project(Self::to_value(args)).await?,
            "update_project" => self.update_project(Self::to_value(args)).await?,
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
            "create_reminder" => self.create_reminder(Self::to_value(args)).await?,
            "update_reminder" => self.update_reminder(Self::to_value(args)).await?,
            "delete_reminder" => {
                let input: crate::tools::reminder::ReminderId = Self::parse(args)?;
                self.delete_reminder(input).await?
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
            "create_tag" => self.create_tag(Self::to_value(args)).await?,
            "update_tag" => self.update_tag(Self::to_value(args)).await?,
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
            "create_interaction" => self.create_interaction(Self::to_value(args)).await?,
            "update_interaction" => self.update_interaction(Self::to_value(args)).await?,
            "delete_interaction" => {
                let input: crate::tools::interaction::InteractionId = Self::parse(args)?;
                self.delete_interaction(input).await?
            }
            "archive_summary" => self.archive_summary().await?,
            "archive_counts" => self.archive_counts().await?,
            "archive_list" => {
                let input: crate::tools::archive::ArchiveListQuery = Self::parse(args)?;
                self.archive_list(input).await?
            }
            "archive_unarchive_one" => {
                let input: crate::tools::archive::ArchiveUnarchiveInput = Self::parse(args)?;
                self.archive_unarchive_one(input).await?
            }
            "archive_bulk_unarchive" => {
                let input: crate::tools::archive::ArchiveBulkUnarchiveInput = Self::parse(args)?;
                self.archive_bulk_unarchive(input).await?
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
            "sync_push" => {
                let input: crate::tools::sync::SyncPushInput = Self::parse(args)?;
                self.sync_push(input).await?
            }
            "sync_pull" => {
                let input: crate::tools::sync::SyncPullInput = Self::parse(args)?;
                self.sync_pull(input).await?
            }
            other => {
                return Err(RmcpError::invalid_request(
                    format!("unknown tool: {other}"),
                    None,
                ));
            }
        };
        let content = Content::json(v).map_err(|e| RmcpError::internal_error(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![content]))
    }

    async fn list_tools(
        &self,
        _request: PaginatedRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, RmcpError> {
        let mut tools = tier1_tools();
        if matches!(self.cfg.tier, Tier::Full) {
            tools.extend(tier2_tools());
        }
        Ok(ListToolsResult {
            tools,
            next_cursor: None,

        })
    }

    fn get_info(&self) -> ServerInfo {
        let tier = self.cfg.tier.clone();
        ServerInfo {
            protocol_version: Default::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "weavine-mcp".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                ..Default::default()
            },
            instructions: Some(match tier {
                Tier::Default => "weavine-mcp (Tier 1): contacts, events, actions, projects, reminders + your api_key. Set WEAVINE_MCP_TIER=full for additional resources.".to_string(),
                Tier::Full => "weavine-mcp (Tier 2 / full): full access.".to_string(),
            }),
            ..Default::default()
        }
    }
}
