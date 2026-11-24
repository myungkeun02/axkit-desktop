//! A small Server-Sent Events parser (only what `GET stream` sends: `event`, `id`, `data`, comments).

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub id: Option<String>,
    pub data: String,
}

/// Feed raw bytes as they arrive; complete events come out. Handles `\n`, `\r\n` and chunks split anywhere
/// (including inside a UTF-8 character).
#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
    event: Option<String>,
    id: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line).into_owned();
            if let Some(event) = self.line(&line) {
                out.push(event);
            }
        }
        out
    }

    fn line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            if self.data.is_empty() {
                self.event = None;
                return None;
            }
            let event = SseEvent { event: self.event.take(), id: self.id.take(), data: self.data.join("\n") };
            self.data.clear();
            return Some(event);
        }
        if line.starts_with(':') {
            return None; // keepalive / comment
        }
        let (field, value) = match line.find(':') {
            Some(i) => {
                let v = &line[i + 1..];
                (&line[..i], v.strip_prefix(' ').unwrap_or(v))
            }
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "id" => self.id = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_and_skips_keepalives() {
        let mut p = SseParser::new();
        let out = p.push(b": open\n\nevent: message\nid: 42\ndata: {\"seq\":42}\n\n: keepalive\n\n");
        assert_eq!(out, vec![SseEvent { event: Some("message".into()), id: Some("42".into()), data: "{\"seq\":42}".into() }]);
    }

    #[test]
    fn survives_split_chunks_and_crlf() {
        let mut p = SseParser::new();
        let whole = "event: notice\r\nid: 7\r\ndata: {\"text\":\"안녕하세요\"}\r\n\r\n".as_bytes();
        let mut out = Vec::new();
        for chunk in whole.chunks(3) {
            out.extend(p.push(chunk));
        }
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].data, "{\"text\":\"안녕하세요\"}");
        assert_eq!(out[0].id.as_deref(), Some("7"));
    }

    #[test]
    fn joins_multiline_data() {
        let mut p = SseParser::new();
        let out = p.push(b"data: a\ndata: b\n\n");
        assert_eq!(out[0].data, "a\nb");
        assert_eq!(out[0].event, None);
    }
}
