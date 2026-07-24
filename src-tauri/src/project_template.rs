use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Template {
    General,
    Sales,
    ProductDev,
}

impl Template {
    pub fn id_str(self) -> &'static str {
        match self {
            Template::General => "general",
            Template::Sales => "sales",
            Template::ProductDev => "product_dev",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Template::General => "通用项目",
            Template::Sales => "销售管线",
            Template::ProductDev => "产品开发",
        }
    }
    pub fn stages(self) -> &'static [&'static str] {
        match self {
            Template::General => &["待启动", "进行中", "待收尾", "已完成"],
            Template::Sales => &["线索", "商机", "沟通", "报价", "丢单", "中标"],
            Template::ProductDev => &["立项", "设计", "开发", "发布", "推广", "终止"],
        }
    }
    pub fn terminal_stages(self) -> &'static [&'static str] {
        match self {
            Template::General => &["已完成"],
            Template::Sales => &["中标", "丢单"],
            Template::ProductDev => &["终止"],
        }
    }
    pub fn first_stage(self) -> &'static str {
        self.stages()[0]
    }
    pub fn is_terminal(self, stage: &str) -> bool {
        self.terminal_stages().contains(&stage)
    }
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "general" => Some(Self::General),
            "sales" => Some(Self::Sales),
            "product_dev" => Some(Self::ProductDev),
            _ => None,
        }
    }
}
