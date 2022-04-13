// @ts-check
'use strict'

const util = require('util')
const stream = require('stream')
const fs = require('fs')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')

const fetch = require('node-fetch')

const spawn = util.promisify(childProcess.spawn)
const pipeline = util.promisify(stream.pipeline)

const MAX_MESSAGE_KB = 512 * 1024

const write = s => {
  if (s.includes('\n')) {
    throw new Error('invalid write()')
  }

  if (s.length > MAX_MESSAGE_KB) {
    const len = Math.ceil(s.length / 1024)
    process.stderr.write('WARNING: Sending large message to webview: ' + len + 'kb\n')
    process.stderr.write('RAW MESSAGE: ' + s.slice(0, 512) + '...\n')
  }

  return new Promise(resolve =>
    process.stdout.write(s + '\n', resolve)
  )
}

console.log = (...args) => {
  const s = args.map(v => util.format(v)).join(' ')
  const enc = encodeURIComponent(s)
  // fs.appendFileSync('tmp.log', s + '\n')
  write(`ipc://stdout?value=${enc}`)
}
console.error = console.log

process.on('exit', (exitCode) => {
  const seq = ipc.nextSeq++

  let value = new URLSearchParams({
    index: '0',
    seq,
    value: String(exitCode)
  }).toString()

  value = value.replace(/\+/g, '%20')

  fs.writeSync(1, `ipc://exit?${value}\n`)
  try {
    fs.fsyncSync(1)
  } catch (_) {
    // fsync(1) can fail in github actions for reasons unclear.
    // maybe the stdout is weird in that environment.
  }
})

//
// Internal IPC API
//
const ipc = { nextSeq: 0 }

ipc.resolve = async (seq, state, value) => {
  const method = !Number(state) ? 'resolve' : 'reject'
  if (!ipc[seq] || !ipc[seq][method]) return

  /**
   * TODO Who handles this error ?
   */
  try {
    await ipc[seq][method](value)
  } finally {
    delete ipc[seq]
  }
}

ipc.request = async (cmd, opts) => {
  const seq = ipc.nextSeq++
  let value = ''

  const promise = new Promise((resolve, reject) => {
    ipc[seq] = {
      resolve: resolve,
      reject: reject
    }
  })

  try {
    if (typeof opts.value === 'object') {
      opts.value = JSON.stringify(opts.value)
    }

    value = new URLSearchParams({
      ...opts,
      index: opts.window || '0',
      seq,
      value: opts.value || '0'
    }).toString()

    value = value.replace(/\+/g, '%20')
  } catch (err) {
    console.error(`Cannot encode request ${err.message} (${value})`)
    return Promise.reject(err)
  }

  await write(`ipc://${cmd}?${value}`)
  return promise
}

ipc.send = async o => {
  try {
    // TODO: use structuredClone instead once we are on node 17+
    o = JSON.parse(JSON.stringify(o))
  } catch (err) {
    console.error(`Cannot encode data to send via IPC:\n${err.message}`)
    return Promise.reject(err)
  }

  if (typeof o.value === 'object') {
    o.value = JSON.stringify(o.value)
  }

  let s = new URLSearchParams({
    event: o.event,
    index: o.window || '0',
    value: o.value
  }).toString()

  s = s.replace(/\+/g, '%20')

  await write(`ipc://send?${s}`)
}

process.stdin.resume()
process.stdin.setEncoding('utf8')

let buf = ''

async function handleMessage (data) {
  const messages = data.split('\n')

  if (messages.length === 1) {
    buf += data
    return
  }

  const firstMsg = buf + messages[0]
  parse(firstMsg)

  for (let i = 1; i < messages.length - 1; i++) {
    parse(messages[i])
  }

  buf = messages[messages.length - 1]
}

async function parse (data) {
  let cmd = ''
  let index = '0'
  let seq = '0'
  let state = '0'
  let value = ''

  if (data.length > MAX_MESSAGE_KB) {
    const len = Math.ceil(data.length / 1024)
    process.stderr.write(
      'WARNING: Receiving large message from webview: ' + len + 'kb\n'
    )
    process.stderr.write('RAW MESSAGE: ' + data.slice(0, 512) + '...\n')
  }

  try {
    const u = new URL(data)
    const o = Object.fromEntries(u.searchParams)
    cmd = u.host
    seq = o.seq
    index = o.index
    state = o.state || '0'

    if (o.value) {
      value = JSON.parse(o.value)
    }
  } catch (err) {
    const dataStart = data.slice(0, 100)
    const dataEnd = data.slice(data.length - 100)

    console.error(`Unable to parse stdin message ${err.code} ${err.message.slice(0, 100)} (${dataStart}...${dataEnd})`)
    throw new Error(`Unable to parse stdin message ${err.code} ${err.message.slice(0, 20)}`)
  }

  if (cmd === 'resolve') {
    return ipc.resolve(seq, state, value) // being asked to resolve a promise
  }

  let resultObj
  let result = ''

  try {
    resultObj = await api.receive(cmd, value)
  } catch (err) {
    resultObj = {
      err: { message: err.message }
    }
    state = 1
  }

  if (resultObj === undefined) {
    resultObj = null
  }

  try {
    result = JSON.stringify(resultObj)
  } catch (err) {
    state = 1
    result = JSON.stringify({
      err: { message: err.message }
    })
  }

  let s = new URLSearchParams({
    seq,
    state,
    index,
    value: result
  }).toString()

  s = s.replace(/\+/g, '%20')

  await write(`ipc://resolve?${s}`) // asking to resolve a promise
}

process.stdin.on('data', handleMessage)

//
// Exported API
// ---
//
const api = {
  /**
   * @param {{ window: number }} o
   */
  show (o) {
    return ipc.request('show', o)
  },

  /**
   * @param {{ window: number }} o
   */
  hide (o) {
    return ipc.request('hide', o)
  },

  /**
   * @param {{ window: number, value: string }} o
   */
  navigate (o) {
    return ipc.request('navigate', o)
  },

  /**
   * @param {{ window: number, value: string }} o
   */
  setTitle (o) {
    return ipc.request('title', o)
  },

  /**
   * @param {{ window: number, height: number, width: number }} o
   */
  setSize (o) {
    return ipc.request('size', o)
  },

  getScreenSize () {
    return ipc.request('getScreenSize', { value: {} })
  },

  /**
   * @param {{ value: number }} o
   */
  exit (o) {
    return ipc.request('exit', o)
  },

  /**
   * @param {{ window: number, value: string }} o
   */
  setMenu (o) {
    const menu = o.value

    // validate the menu
    if (menu.length === 0) {
      throw new Error('Menu must have length')
    }

    const menus = menu.match(new RegExp('\\w+:\\n', 'g'))
    const menuTerminals = menu.match(new RegExp(';', 'g'))
    const delta = menus.length - menuTerminals.length

    if ((delta !== 0) && (delta !== -1)) {
      throw new Error(`Expected ${menuTerminals.length} ';', found ${menus}.`)
    }

    const lines = menu.split('\n')
    const e = new Error()
    const frame = e.stack.split("\n")[2]
    const callerLineNo = frame.split(":").reverse()[1]

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const l = Number(callerLineNo) + i

      let errMsg

      if (line.trim().length === 0) continue
      if (/.*:\n/.test(line)) continue // ignore submenu labels
      if (/---/.test(line)) continue // ignore separators
      if (/\w+/.test(line) && !line.includes(':')) {
        errMsg = 'Missing label'
      } else if (/:\s*\+/.test(line)) {
        errMsg = 'Missing accelerator'
      } else if (/\+(\n|$)/.test(line)) {
        errMsg = 'Missing modifier'
      }

      if (errMsg) {
        throw new Error(`${errMsg} on line ${l}: "${line}"`)
      }
    }

    // send the request to set the menu
    return ipc.request('menu', o)
  },

  /**
   * @param {{ window: number, indexMain: number, indexSub: number }} o
   */
  setMenuItemEnabled (o) {
    return ipc.request('menuItemEnabled', o)
  },

  /**
   * @param {{ window: number, value: string }} o
   */
  openExternal (o) {
    return ipc.request('external', o)
  },

  /**
   * @param {{ window: number, event: string, value: any }} o
   */
  send (o) {
    return ipc.send(o)
  },

  restart () {
    return ipc.request('restart', { })
  },

  /**
   * @param {any} o
   */
  receive (o) {
    console.error('Receive Not Implemented', o)
    return { err: new Error('Not Implemented!') }
  }
}

module.exports = api

if (process.argv.includes('--webviewFailed')) {
  installWebView()
}

// eslint-disable-next-line
async function installWebView () {
  //
  // this will go away in the near future. WebView2 is a new feature
  // and we want to be sure the user has it, if they don't, download
  // and install it for them.
  //

  // console.log('installWebView() fetch()')
  const res = await fetch('https://go.microsoft.com/fwlink/p/?LinkId=2124703')

  // console.log('fetch status', res.status)
  if (res.status !== 200) {
    // console.log('attempt to alert()')
    return api.alert({
      value: 'Could not connect to go.microsoft.com to download required native resources'
    })
  }

  const tmpDir = os.tmpdir()
  const dest = path.join(tmpDir, 'webview-installer.exe')

  // console.log('write res.body to tmp', dest)
  await pipeline(res.body, fs.createWriteStream(dest))
  // console.log('spawn tmp exe', dest)
  await spawn(dest, [], {
    stdio: 'inherit'
  })
  // console.log('spawn yields')

  api.restart()
}
