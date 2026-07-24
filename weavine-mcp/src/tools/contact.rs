use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ContactId {
    #[schemars(description = "Contact UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for contact listings.")]
pub struct ListContactsQuery {
    #[schemars(description = "Search query (matches nickname, name, email, phone).")]
    #[serde(default)]
    pub q: Option<String>,

    #[schemars(description = "Filter by tag name.")]
    #[serde(default)]
    pub tag: Option<String>,

    #[schemars(description = "Maximum number of contacts to return.")]
    #[serde(default)]
    pub limit: Option<u32>,

    #[schemars(description = "Pagination offset (skip N results).")]
    #[serde(default)]
    pub offset: Option<u32>,

    #[schemars(description = "Sort order. Values: last_contacted_at, created_at, nickname.")]
    #[serde(default)]
    pub sort: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new contact.")]
pub struct CreateContactBody {
    #[schemars(description = "Contact nickname (display name). Required.")]
    pub nickname: String,

    #[schemars(description = "Full name.")]
    #[serde(default)]
    pub name: Option<String>,

    #[schemars(description = "Company / organization.")]
    #[serde(default)]
    pub company: Option<String>,

    #[schemars(description = "Job title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "City.")]
    #[serde(default)]
    pub city: Option<String>,

    #[schemars(description = "Email address.")]
    #[serde(default)]
    pub email: Option<String>,

    #[schemars(description = "Phone number.")]
    #[serde(default)]
    pub phone: Option<String>,

    #[schemars(description = "WeChat ID.")]
    #[serde(default)]
    pub wechat: Option<String>,

    #[schemars(description = "Free-form notes.")]
    #[serde(default)]
    pub notes: Option<String>,

    #[schemars(description = "Importance level. Typical values: low, medium, high. Defaults to medium.")]
    #[serde(default)]
    pub importance: Option<String>,

    #[schemars(description = "Reminder interval in days.")]
    #[serde(default)]
    pub reminder_interval_days: Option<i32>,

    #[schemars(description = "Tag UUIDs to associate with this contact.")]
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating a contact. Pass only fields to change.")]
pub struct UpdateContactFields {
    #[schemars(description = "Replace the nickname.")]
    #[serde(default)]
    pub nickname: Option<String>,

    #[schemars(description = "Replace the full name.")]
    #[serde(default)]
    pub name: Option<String>,

    #[schemars(description = "Replace the company.")]
    #[serde(default)]
    pub company: Option<String>,

    #[schemars(description = "Replace the job title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "Replace the city.")]
    #[serde(default)]
    pub city: Option<String>,

    #[schemars(description = "Replace the email.")]
    #[serde(default)]
    pub email: Option<String>,

    #[schemars(description = "Replace the phone number.")]
    #[serde(default)]
    pub phone: Option<String>,

    #[schemars(description = "Replace the WeChat ID.")]
    #[serde(default)]
    pub wechat: Option<String>,

    #[schemars(description = "Replace the notes.")]
    #[serde(default)]
    pub notes: Option<String>,

    #[schemars(description = "Replace the importance level.")]
    #[serde(default)]
    pub importance: Option<String>,

    #[schemars(description = "Replace the reminder interval in days.")]
    #[serde(default)]
    pub reminder_interval_days: Option<i32>,

    #[schemars(description = "Replace associated tag UUIDs. All existing tags are replaced.")]
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_contact: pick the contact by id, set only fields to change.")]
pub struct UpdateContactBody {
    #[schemars(description = "UUID of the contact to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateContactFields,
}

impl WeavineMcpServer {
    pub async fn list_contacts(
        &self,
        q: ListContactsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = &q.q { pairs.push(("q", v.clone())); }
        if let Some(v) = &q.tag { pairs.push(("tag", v.clone())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        if let Some(v) = &q.sort { pairs.push(("sort", v.clone())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/contacts", &refs, api!()).await?;
        Ok(v)
    }

    pub async fn get_contact(
        &self,
        input: ContactId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/contacts/{}", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn create_contact(
        &self,
        body: CreateContactBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/contacts", &body, api!()).await?;
        Ok(v)
    }

    pub async fn update_contact(
        &self,
        input: UpdateContactBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.put(&format!("/api/contacts/{}", input.id), &input.fields, api!()).await?;
        Ok(v)
    }

    pub async fn delete_contact(
        &self,
        input: ContactId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/contacts/{}", input.id), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
