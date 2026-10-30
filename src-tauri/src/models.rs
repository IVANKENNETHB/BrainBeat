use serde::{Deserialize, Serialize};

/// A quiz question as consumed by the frontend. Field names are serialized in
/// camelCase to match the existing `Question` value object in `src/js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    #[serde(default)]
    pub id: i64,
    /// "builtin" or "imported".
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(rename = "type")]
    pub qtype: String,
    /// Difficulty band: "easy" | "normal" | "hard" | "expert".
    #[serde(default = "default_difficulty")]
    pub difficulty: String,
    pub text: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    /// Either a numeric index (multiple choice) or a string (scramble).
    pub correct_answer: serde_json::Value,
    #[serde(default)]
    pub accepted_answers: Vec<String>,
    #[serde(default)]
    pub explanation: String,
    /// Optional topic the question belongs to. Null means uncategorized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
}

fn default_source() -> String {
    "builtin".to_string()
}

fn default_difficulty() -> String {
    "normal".to_string()
}

/// A user-defined topic (subject) that questions can be organized under.
/// Topics coexist with levels: level drives difficulty/scramble mix, topic
/// drives organization and per-topic leaderboards.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub created_at: String,
}

/// A topic that was removed and is kept in the topic bin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTopic {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub created_at: String,
    /// SQLite datetime of when the topic was moved to the bin.
    pub deleted_at: String,
}

/// Settings returned to the frontend. Serialized in camelCase to match
/// `QuizApi.getSettings()` in `src/js/api.js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub timer_default: i64,
    pub question_count_default: String,
    pub shuffle_choices_default: bool,
    /// "easy" | "normal" | "hard" | "expert".
    pub level_default: String,
    /// Per-level question counts, stored as a JSON map (level -> count).
    pub level_counts: String,
    /// Whether synthesized sound cues are enabled.
    pub sound_default: bool,
    /// Whether looping background music is enabled.
    pub bgm_default: bool,
    /// Background-music volume as a percentage (0-100).
    pub bgm_volume_default: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            timer_default: 0,
            question_count_default: "40".to_string(),
            shuffle_choices_default: false,
            level_default: "normal".to_string(),
            level_counts: "{}".to_string(),
            sound_default: true,
            bgm_default: true,
            bgm_volume_default: 80,
        }
    }
}

/// Aggregate attempt statistics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub correct: i64,
}

/// A persisted quiz team used for the quizmaster leaderboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// The level the team plays on. Every level has its own teams.
    #[serde(default = "default_level")]
    pub level: String,
    /// The topic the team plays on. Every topic has its own teams and leaderboard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    /// The team's best single-game score. Never decreases.
    #[serde(default)]
    pub score: i64,
    /// Total questions the team answered in the run that produced the score.
    #[serde(default)]
    pub total_questions: i64,
    /// Total time (seconds) the team spent answering in that same run.
    #[serde(default)]
    pub time_seconds: i64,
}

fn default_level() -> String {
    "normal".to_string()
}

/// A team that was removed from a level and is kept in the recycle bin.
///
/// Rows are held for 30 days after deletion and then purged, so a host can
/// recover a deleted team (and its score) without losing the leaderboard
/// history that was attached to it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTeam {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub level: String,
    #[serde(default)]
    pub score: i64,
    #[serde(default)]
    pub total_questions: i64,
    #[serde(default)]
    pub time_seconds: i64,
    /// ISO-8601 timestamp of when the team was moved to the bin.
    pub deleted_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_serialize_to_camel_case() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        let obj = json.as_object().unwrap();

        // The frontend (src/js/api.js applySettings) reads camelCase keys.
        for key in [
            "timerDefault",
            "questionCountDefault",
            "shuffleChoicesDefault",
            "levelDefault",
            "levelCounts",
            "soundDefault",
            "bgmDefault",
            "bgmVolumeDefault",
        ] {
            assert!(obj.contains_key(key), "missing camelCase key: {}", key);
        }

        assert_eq!(json["levelDefault"], "normal");
        assert_eq!(json["levelCounts"], "{}");
        assert_eq!(json["soundDefault"], true);
        assert_eq!(json["bgmDefault"], true);
        assert_eq!(json["bgmVolumeDefault"], 80);
    }

    #[test]
    fn question_serializes_type_and_camel_case() {
        let q = Question {
            id: 1,
            source: "builtin".into(),
            qtype: "multiple-choice".into(),
            difficulty: "hard".into(),
            text: "Q?".into(),
            options: Some(vec!["A".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: String::new(),
            topic_id: None,
        };

        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["type"], "multiple-choice");
        assert_eq!(json["difficulty"], "hard");
        assert_eq!(json["correctAnswer"], 0);
        assert_eq!(json["acceptedAnswers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn question_without_difficulty_defaults_to_normal() {
        let q: Question = serde_json::from_str(
            r#"{"type":"multiple-choice","text":"Q?","correctAnswer":0}"#,
        )
        .unwrap();

        assert_eq!(q.difficulty, "normal");
    }

    #[test]
    fn team_serializes_the_answering_time() {
        let team = Team {
            id: 1,
            name: "Gray".into(),
            level: "expert".into(),
            topic_id: None,
            score: 8,
            total_questions: 10,
            time_seconds: 300,
        };

        let json = serde_json::to_value(&team).unwrap();
        assert_eq!(json["name"], "Gray");
        assert_eq!(json["level"], "expert");
        assert_eq!(json["score"], 8);
        assert_eq!(json["totalQuestions"], 10);
        assert_eq!(json["timeSeconds"], 300);
    }

    #[test]
    fn team_without_level_defaults_to_normal() {
        let team: Team = serde_json::from_str(r#"{"name":"Gray","score":8}"#).unwrap();

        assert_eq!(team.level, "normal");
    }

    #[test]
    fn topic_serializes_to_camel_case() {
        let topic = Topic {
            id: 1,
            name: "History".into(),
            created_at: "2024-01-01 00:00:00".into(),
        };

        let json = serde_json::to_value(&topic).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "History");
        assert_eq!(json["createdAt"], "2024-01-01 00:00:00");
    }

    #[test]
    fn deleted_topic_serializes_to_camel_case() {
        let deleted = DeletedTopic {
            id: 1,
            name: "History".into(),
            created_at: "2024-01-01 00:00:00".into(),
            deleted_at: "2024-01-15 00:00:00".into(),
        };

        let json = serde_json::to_value(&deleted).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "History");
        assert_eq!(json["createdAt"], "2024-01-01 00:00:00");
        assert_eq!(json["deletedAt"], "2024-01-15 00:00:00");
    }

    #[test]
    fn question_with_topic_id_serializes() {
        let q = Question {
            id: 1,
            source: "imported".into(),
            qtype: "multiple-choice".into(),
            difficulty: "normal".into(),
            text: "Q?".into(),
            options: Some(vec!["A".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: String::new(),
            topic_id: Some(5),
        };

        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["topicId"], 5);
    }

    #[test]
    fn question_without_topic_id_omits_field() {
        let q = Question {
            id: 1,
            source: "imported".into(),
            qtype: "multiple-choice".into(),
            difficulty: "normal".into(),
            text: "Q?".into(),
            options: Some(vec!["A".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: String::new(),
            topic_id: None,
        };

        let json = serde_json::to_value(&q).unwrap();
        assert!(!json.as_object().unwrap().contains_key("topicId"));
    }

    #[test]
    fn team_with_topic_id_serializes() {
        let team = Team {
            id: 1,
            name: "Gray".into(),
            level: "expert".into(),
            topic_id: Some(3),
            score: 8,
            total_questions: 10,
            time_seconds: 300,
        };

        let json = serde_json::to_value(&team).unwrap();
        assert_eq!(json["topicId"], 3);
    }

    #[test]
    fn team_without_topic_id_omits_field() {
        let team = Team {
            id: 1,
            name: "Gray".into(),
            level: "expert".into(),
            topic_id: None,
            score: 8,
            total_questions: 10,
            time_seconds: 300,
        };

        let json = serde_json::to_value(&team).unwrap();
        assert!(!json.as_object().unwrap().contains_key("topicId"));
    }
}
