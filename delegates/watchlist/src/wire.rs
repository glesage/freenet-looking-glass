pub enum Op {
    Get,
    Set,
}

pub struct Request {
    pub op: Op,
    pub id: u32,
    pub blob: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    NotFound,
    StoreFailed,
    BadRequest,
}

const OP_GET: u8 = 0x00;
const OP_SET: u8 = 0x01;

const STATUS_OK: u8 = 0x00;
const STATUS_NOT_FOUND: u8 = 0x01;
const STATUS_STORE_FAILED: u8 = 0x02;
const STATUS_BAD_REQUEST: u8 = 0x03;

const PREFIX: &[u8] = b"lg.watchlist.v1:";

pub fn parse_request(bytes: &[u8]) -> Option<Request> {
    if bytes.len() < 5 {
        return None;
    }
    let op = match bytes[0] {
        OP_GET => Op::Get,
        OP_SET => Op::Set,
        _ => return None,
    };
    let id = u32::from_le_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
    let blob = bytes[5..].to_vec();
    Some(Request { op, id, blob })
}

pub fn encode_response(op: &Op, id: u32, status: Status, blob: &[u8]) -> Vec<u8> {
    let status_byte = match status {
        Status::Ok => STATUS_OK,
        Status::NotFound => STATUS_NOT_FOUND,
        Status::StoreFailed => STATUS_STORE_FAILED,
        Status::BadRequest => STATUS_BAD_REQUEST,
    };
    let mut out = Vec::with_capacity(6 + blob.len());
    out.push(match op {
        Op::Get => OP_GET,
        Op::Set => OP_SET,
    });
    out.extend_from_slice(&id.to_le_bytes());
    out.push(status_byte);
    out.extend_from_slice(blob);
    out
}

pub fn secret_key_for(ns: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(PREFIX.len() + ns.len());
    key.extend_from_slice(PREFIX);
    key.extend_from_slice(ns);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_request(op: &Op, id: u32, blob: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + blob.len());
        out.push(match op {
            Op::Get => OP_GET,
            Op::Set => OP_SET,
        });
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(blob);
        out
    }

    mod hex {
        pub fn encode(bytes: impl AsRef<[u8]>) -> String {
            bytes
                .as_ref()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect()
        }
    }

    #[test]
    fn get_round_trip() {
        let raw = encode_request(&Op::Get, 7, &[]);
        let req = parse_request(&raw).unwrap();
        assert!(matches!(req.op, Op::Get));
        assert_eq!(req.id, 7);
        assert!(req.blob.is_empty());
    }

    #[test]
    fn set_round_trip_with_blob() {
        let blob = b"hello".to_vec();
        let raw = encode_request(&Op::Set, 42, &blob);
        let req = parse_request(&raw).unwrap();
        assert!(matches!(req.op, Op::Set));
        assert_eq!(req.id, 42);
        assert_eq!(req.blob, blob);
    }

    #[test]
    fn truncated_input_returns_none() {
        assert!(parse_request(&[0x00, 0x01, 0x02, 0x03]).is_none());
    }

    #[test]
    fn unknown_op_returns_none() {
        assert!(parse_request(&[0xff, 0, 0, 0, 0]).is_none());
    }

    #[test]
    fn secret_keys_are_distinct_and_prefix_stable() {
        let local = secret_key_for(b"local");
        let hosted = secret_key_for(b"7AbCdEfGhIjKlMnOpQrStUvWxYz123456");
        assert_ne!(local, hosted);
        assert!(local.starts_with(PREFIX));
        assert!(hosted.starts_with(PREFIX));
    }

    #[test]
    fn cross_language_set_fixture_hex() {
        let raw = encode_request(&Op::Set, 42, b"hello");
        assert_eq!(hex::encode(raw), "012a00000068656c6c6f");
    }
}
