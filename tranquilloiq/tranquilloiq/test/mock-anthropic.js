const EVENTS = [
  ["message_start", {type:"message_start",message:{id:"m",type:"message",role:"assistant",model:"claude-opus-5",content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}}],
  ["content_block_start", {type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
  ["content_block_delta", {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK."}}],
  ["content_block_stop", {type:"content_block_stop",index:0}],
  ["message_delta", {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:2}}],
  ["message_stop", {type:"message_stop"}],
];
let mode = "fail";
export const setMode = (m) => { mode = m; };
export const handler = (_q, r) => {
  if (mode === "fail") {
    r.writeHead(500, { "Content-Type": "application/json" });
    return r.end('{"error":{"type":"api_error","message":"boom"}}');
  }
  r.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [e, d] of EVENTS) r.write("event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n");
  r.end();
};
