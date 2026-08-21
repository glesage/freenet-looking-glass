use freenet_stdlib::prelude::*;

mod wire;
use wire::{encode_response, parse_request, secret_key_for, Op, Status};

struct WatchlistDelegate;

fn namespace(origin: Option<MessageOrigin>) -> Vec<u8> {
    match origin {
        Some(MessageOrigin::WebApp(id)) => id.encode().into_bytes(),
        _ => b"local".to_vec(),
    }
}

#[delegate]
impl DelegateInterface for WatchlistDelegate {
    fn process(
        ctx: &mut DelegateCtx,
        _parameters: Parameters<'static>,
        origin: Option<MessageOrigin>,
        message: InboundDelegateMsg,
    ) -> Result<Vec<OutboundDelegateMsg>, DelegateError> {
        let InboundDelegateMsg::ApplicationMessage(app) = message else {
            return Ok(vec![]);
        };
        let key = secret_key_for(&namespace(origin));
        let reply = match parse_request(&app.payload) {
            None => encode_response(&Op::Get, 0, Status::BadRequest, &[]),
            Some(req) => match req.op {
                Op::Get => match ctx.get_secret(&key) {
                    Some(v) => encode_response(&Op::Get, req.id, Status::Ok, &v),
                    None => encode_response(&Op::Get, req.id, Status::NotFound, &[]),
                },
                Op::Set => {
                    let st = if ctx.set_secret(&key, &req.blob) {
                        Status::Ok
                    } else {
                        Status::StoreFailed
                    };
                    encode_response(&Op::Set, req.id, st, &[])
                }
            },
        };
        Ok(vec![OutboundDelegateMsg::ApplicationMessage(
            ApplicationMessage::new(reply).processed(true),
        )])
    }
}
