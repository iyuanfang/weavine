use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Template {
    General,
    Sales,
    EventPrep,
}

impl Template {
    pub fn id_str(self) -> &'static str {
        match self {
            Template::General => "general",
            Template::Sales => "sales",
            Template::EventPrep => "event_prep",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Template::General => "通用项目",
            Template::Sales => "销售管线",
            Template::EventPrep => "活动筹备",
        }
    }
    pub fn stages(self) -> &'static [&'static str] {
        match self {
            Template::General => &["计划", "进行中", "已完成"],
            Template::Sales => &["线索", "商机", "沟通", "报价", "丢单", "中标"],
            Template::EventPrep => &["筹备中", "进行中", "已收尾"],
        }
    }
    pub fn first_stage(self) -> &'static str {
        self.stages()[0]
    }
    pub fn is_terminal(self, stage: &str) -> bool {
        self.stages().last() == Some(&stage)
    }
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "general" => Some(Self::General),
            "sales" => Some(Self::Sales),
            "event_prep" => Some(Self::EventPrep),
            _ => None,
        }
    }
}
