var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ssc_node_exports = {};
__export(ssc_node_exports, {
  default: () => ssc_node_default
});
module.exports = __toCommonJS(ssc_node_exports);
var import_util = require("util");
var import_fs = require("fs");
const AUTO_CLOSE = process.env.AUTO_CLOSE;
const MAX_MESSAGE_KB = 512 * 1024;
function isObject(o) {
  return o && typeof o === "object" && !Array.isArray(o);
}
const write = (s) => {
  if (s.includes("\n")) {
    throw new Error("invalid write()");
  }
  if (s.length > MAX_MESSAGE_KB) {
    const len = Math.ceil(s.length / 1024);
    process.stderr.write("WARNING: Sending large message to webview: " + len + "kb\n");
    process.stderr.write("RAW MESSAGE: " + s.slice(0, 512) + "...\n");
  }
  return new Promise((resolve) => process.stdout.write(s + "\n", resolve));
};
console.log = (...args) => {
  const s = args.map((v) => (0, import_util.format)(v)).join(" ");
  const enc = encodeURIComponent(s);
  write(`ipc://stdout?value=${enc}`);
};
console.error = console.log;
process.on("exit", (exitCode) => {
  const seq = String(ipc.nextSeq++);
  let value = new URLSearchParams({
    index: "0",
    seq,
    value: String(exitCode)
  }).toString();
  value = value.replace(/\+/g, "%20");
  (0, import_fs.writeSync)(1, `ipc://exit?${value}
`);
  try {
    (0, import_fs.fsyncSync)(1);
  } catch (_) {
  }
});
const ipc = { nextSeq: 0 };
ipc.resolve = async (seq, state, value) => {
  const method = !Number(state) ? "resolve" : "reject";
  if (!ipc[seq] || !ipc[seq][method])
    return;
  try {
    await ipc[seq][method](value);
  } finally {
    delete ipc[seq];
  }
};
ipc.request = async (cmd, opts) => {
  const seq = ipc.nextSeq++;
  let value = "";
  const promise = new Promise((resolve, reject) => {
    ipc[seq] = {
      resolve,
      reject
    };
  });
  try {
    if (typeof opts.value === "object") {
      opts.value = JSON.stringify(opts.value);
    }
    value = new URLSearchParams({
      ...opts,
      index: opts.window || "0",
      seq,
      value: opts.value || "0"
    }).toString();
    value = value.replace(/\+/g, "%20");
  } catch (err) {
    console.error(`Cannot encode request ${err.message} (${value})`);
    return Promise.reject(err);
  }
  await write(`ipc://${cmd}?${value}`);
  return promise;
};
ipc.send = async (o) => {
  try {
    o = JSON.parse(JSON.stringify(o));
  } catch (err) {
    console.error(`Cannot encode data to send via IPC:
${err.message}`);
    return Promise.reject(err);
  }
  if (typeof o.value === "object") {
    o.value = JSON.stringify(o.value);
  }
  let s = new URLSearchParams({
    event: o.event,
    index: o.window || "0",
    value: o.value
  }).toString();
  s = s.replace(/\+/g, "%20");
  await write(`ipc://send?${s}`);
};
process.stdin.resume();
process.stdin.setEncoding("utf8");
let buf = "";
async function handleMessage(data) {
  const messages = data.split("\n");
  if (messages.length === 1) {
    buf += data;
    return;
  }
  const firstMsg = buf + messages[0];
  parse(firstMsg);
  for (let i = 1; i < messages.length - 1; i++) {
    parse(messages[i]);
  }
  buf = messages[messages.length - 1];
}
async function receiveOpNode(_command, value) {
  if (value?.method === "testUncaught") {
    const opts = value.arguments[0];
    console.error("Got an uncaught in test", opts);
    process.nextTick(() => {
      throw new Error("FRONTEND TEST UNCAUGHT: " + opts.err.message);
    });
  } else if (value?.method === "testConsole") {
    const opts = value.arguments[0];
    const args = JSON.parse(opts.args);
    const firstArg = args[0];
    console.log(...args);
    if (typeof firstArg !== "string") {
      return {};
    }
    let exitCode = -1;
    if (firstArg.indexOf("# ok") === 0) {
      exitCode = 0;
    } else if (firstArg.indexOf("# fail ") === 0) {
      exitCode = 1;
    }
    if (exitCode !== -1 && AUTO_CLOSE !== "false") {
      setTimeout(() => {
        api.exit({ value: exitCode });
      }, 50);
    }
    return {};
  }
}
async function parse(data) {
  let cmd = "";
  let index = "0";
  let seq = "0";
  let state = "0";
  let value = "";
  if (data.length > MAX_MESSAGE_KB) {
    const len = Math.ceil(data.length / 1024);
    process.stderr.write("WARNING: Receiving large message from webview: " + len + "kb\n");
    process.stderr.write("RAW MESSAGE: " + data.slice(0, 512) + "...\n");
  }
  try {
    const u = new URL(data);
    const o = Object.fromEntries(u.searchParams);
    cmd = u.host;
    seq = o.seq;
    index = o.index;
    state = o.state || "0";
    if (o.value) {
      value = JSON.parse(o.value);
    }
  } catch (err) {
    const dataStart = data.slice(0, 100);
    const dataEnd = data.slice(data.length - 100);
    console.error(`Unable to parse stdin message ${err.code} ${err.message.slice(0, 100)} (${dataStart}...${dataEnd})`);
    throw new Error(`Unable to parse stdin message ${err.code} ${err.message.slice(0, 20)}`);
  }
  if (cmd === "resolve") {
    return ipc.resolve(seq, state, value);
  }
  let resultObj;
  let result = "";
  try {
    if (isObject(value) && Reflect.get(value, "api") === "ssc-node") {
      resultObj = await receiveOpNode(cmd, value);
    } else {
      resultObj = await api.receive(cmd, value);
    }
  } catch (err) {
    resultObj = {
      err: { message: err.message }
    };
    state = "1";
  }
  if (resultObj === void 0) {
    resultObj = null;
  }
  try {
    result = JSON.stringify(resultObj);
  } catch (err) {
    state = "1";
    result = JSON.stringify({
      err: { message: err.message }
    });
  }
  let s = new URLSearchParams({
    seq,
    state,
    index,
    value: result
  }).toString();
  s = s.replace(/\+/g, "%20");
  await write(`ipc://resolve?${s}`);
}
process.stdin.on("data", handleMessage);
const api = {
  show(o) {
    return ipc.request("show", o);
  },
  hide(o) {
    return ipc.request("hide", o);
  },
  navigate(o) {
    return ipc.request("navigate", o);
  },
  setTitle(o) {
    return ipc.request("title", o);
  },
  setSize(o) {
    return ipc.request("size", o);
  },
  getScreenSize() {
    return ipc.request("getScreenSize", { value: {} });
  },
  exit(o) {
    return ipc.request("exit", o);
  },
  setMenu(o) {
    const menu = o.value;
    if (typeof menu !== "string" || menu.trim().length === 0) {
      throw new Error("Menu must be a non-empty string");
    }
    const menus = menu.match(/\w+:\n/g);
    if (!menus) {
      throw new Error("Menu must have a valid format");
    }
    const menuTerminals = menu.match(/;/g);
    const delta = menus.length - (menuTerminals?.length ?? 0);
    if (delta !== 0 && delta !== -1) {
      throw new Error(`Expected ${menuTerminals.length} ';', found ${menus}.`);
    }
    const lines = menu.split("\n");
    const e = new Error();
    const frame = e.stack.split("\n")[2];
    const callerLineNo = frame.split(":").reverse()[1];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const l = Number(callerLineNo) + i;
      let errMsg;
      if (line.trim().length === 0)
        continue;
      if (/.*:\n/.test(line))
        continue;
      if (/---/.test(line))
        continue;
      if (/\w+/.test(line) && !line.includes(":")) {
        errMsg = "Missing label";
      } else if (/:\s*\+/.test(line)) {
        errMsg = "Missing accelerator";
      } else if (/\+(\n|$)/.test(line)) {
        errMsg = "Missing modifier";
      }
      if (errMsg) {
        throw new Error(`${errMsg} on line ${l}: "${line}"`);
      }
    }
    return ipc.request("menu", o);
  },
  setMenuItemEnabled(o) {
    return ipc.request("menuItemEnabled", o);
  },
  openExternal(o) {
    return ipc.request("external", o);
  },
  send(o) {
    return ipc.send(o);
  },
  restart() {
    return ipc.request("restart", {});
  },
  heartbeat() {
    return ipc.request("heartbeat", {});
  },
  receive(command, value) {
    console.error(`Receive Not Implemented.
Command: ${command}
Value: ${value}`);
    return { err: new Error("Not Implemented!") };
  }
};
var ssc_node_default = api;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {});
