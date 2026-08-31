use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for note listings.")]
pub struct ListNotesQuery {
    #[schemars(description = "Maximum number of notes to return (1-200). Defaults to 30.")]
    #[serde(default)]
    pub limit: Option<i64>,

    #[schemars(description = "Pagination cursor from a previous list response, format \"updated_at,id\". Omit for first page.")]
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct NoteId {
    #[schemars(description = "Note UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "A typed link from a note to another entity. Use one of: contact, project, event, action, interaction.")]
pub struct NoteEntityLinkInput {
    #[schemars(description = "Target entity type. One of: contact, project, event, action, interaction.")]
    pub entity_type: String,

    #[schemars(description = "Target entity UUID.")]
    pub entity_id: String,
}

/// Body for `create_note`. `title` and `body` are required; `entity_links`
/// optionally links the note to other entities at creation time.
#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new note.")]
pub struct CreateNoteBody {
    #[schemars(description = "Note title. Required; non-empty.")]
    pub title: String,

    #[schemars(description = "Note body. Required; non-empty.")]
    pub body: String,

    #[schemars(description = "Optional entity links to attach at creation. Each link's entity_type must be one of contact/project/event/action/interaction.")]
    #[serde(default)]
    pub entity_links: Vec<NoteEntityLinkInput>,
}

/// Mutable fields accepted by `update_note`. Server-controlled fields
/// (`id`, `user_id`, `created_at`) are not allowed here. Passing
/// `entity_links` replaces the full set of links for the note.
#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating a note. Pass only fields to change; entity_links replaces the full set.")]
pub struct UpdateNoteFields {
    #[schemars(description = "Replace the title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "Replace the body.")]
    #[serde(default)]
    pub body: Option<String>,

    #[schemars(description = "Replace the entity_links set. Omit to leave the links unchanged.")]
    #[serde(default)]
    pub entity_links: Option<Vec<NoteEntityLinkInput>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_note: pick the note by id, set only fields to change.")]
pub struct UpdateNoteBody {
    #[schemars(description = "UUID of the note to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateNoteFields,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Filter for note backlinks: returns notes that link to a given entity.")]
pub struct NoteBacklinksQuery {
    #[schemars(description = "Source entity type. One of: contact, project, event, action, interaction.")]
    pub entity_type: String,

    #[schemars(description = "Source entity UUID.")]
    pub entity_id: String,
}

impl WeavineMcpServer {
    #[tracing::instrument(skip_all, fields(tool = stringify!(list_notes)))]
    pub async fn list_notes(
        &self,
        q: ListNotesQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.cursor { pairs.push(("cursor", v)); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.client.get("/api/notes", &refs, api!()).await
    }

    #[tracing::instrument(skip_all, fields(tool = stringify!(get_note)))]
    pub async fn get_note(
        &self,
        input: NoteId,
    ) -> McpResult<serde_json::Value> {
        self.client.get(&format!("/api/notes/{}", input.id), &[], api!()).await
    }

    #[tracing::instrument(skip_all, fields(tool = stringify!(create_note)))]
    pub async fn create_note(
        &self,
        body: CreateNoteBody,
    ) -> McpResult<serde_json::Value> {
        self.client.post("/api/notes", &body, api!()).await
    }

    #[tracing::instrument(skip_all, fields(tool = stringify!(update_note)))]
    pub async fn update_note(
        &self,
        input: UpdateNoteBody,
    ) -> McpResult<serde_json::Value> {
        self.client.put(&format!("/api/notes/{}", input.id), &input.fields, api!()).await
    }

    #[tracing::instrument(skip_all, fields(tool = stringify!(delete_note)))]
    pub async fn delete_note(
        &self,
        input: NoteId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/notes/{}", input.id), api!()).await
    }

    /// Notes that link to a given entity — i.e. "backlinks" from the
    /// entity's perspective. Useful for "show me what I've written about
    /// contact X" queries.
    #[tracing::instrument(skip_all, fields(tool = stringify!(list_note_backlinks)))]
    pub async fn list_note_backlinks(
        &self,
        q: NoteBacklinksQuery,
    ) -> McpResult<serde_json::Value> {
        let pairs = [
            ("entity_type", q.entity_type.as_str()),
            ("entity_id", q.entity_id.as_str()),
        ];
        self.client.get("/api/notes/backlinks", &pairs, api!()).await
    }

    /// Entities a given note links to — i.e. forward links from the
    /// note's perspective. Returns `[{entity_type, entity_id}, ...]`.
    #[tracing::instrument(skip_all, fields(tool = stringify!(list_note_entity_links)))]
    pub async fn list_note_entity_links(
        &self,
        input: NoteId,
    ) -> McpResult<serde_json::Value> {
        self.client.get(&format!("/api/notes/{}/entities", input.id), &[], api!()).await
    }
}