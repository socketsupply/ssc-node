// @ts-check
'use strict'

const util = require('util')

// eslint-disable-next-line
function installWebView () {
  //
  // this will go away in the near future. WebView2 is a new feature
  // and we want to be sure the user has it, if they don't, download
  // and install it for them.
  //

  // fetch('https://go.microsoft.com/fwlink/p/?LinkId=2124703')
}

const write = s => {
  if (s.includes('\n')) {
    throw new Error('invalid write()')
  }

  return new Promise(resolve =>
    process.stdout.write(s + '\n', resolve)
  )
}

console.log = (...args) => {
  const s = args.map(v => util.format(v)).join(' ')
  const enc = encodeURIComponent(s)
  // console.error('flushing ipc://stdout', enc.includes('\n'))
  write(`ipc://stdout?value=${enc}`)
}
console.error = console.log

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
      index: opts.window,
      seq,
      value: opts.value || '0'
    }).toString()
  } catch (err) {
    console.error(`Cannot encode request ${err.message} (${value})`)
    return Promise.reject(err)
  }

  await write(`ipc://${cmd}?${value}`)
  return promise
}

ipc.send = async o => {
  o = JSON.parse(JSON.stringify(o))

  if (typeof o.value === 'object') {
    o.value = JSON.stringify(o.value)
  }

  if (!o.value || !o.value.trim()) return

  const s = new URLSearchParams({
    event: o.event,
    index: o.index,
    value: o.value
  }).toString()

  await write(`ipc://send?${s}`)
}

process.stdin.resume()
process.stdin.setEncoding('utf8')

let buf = ''

process.stdin.on('data', async (/** @type {string} */ data) => {
  let cmd = ''
  let index = 0
  let seq = 0
  let state = 0
  let value = ''

  // console.log('incoming bytes1', data.slice(0, 20), data.includes('\n'))
  // console.log('incoming bytes2', data.slice(0, 20), data.includes('\n'))

  const newLineIndex = data.indexOf('\n')
  if (newLineIndex === -1) {
    buf += data
    return
  } else {
    const oldData = data.slice(newLineIndex)
    data = buf + data.slice(0, newLineIndex)
    buf = oldData

    // console.log('reset buf', buf.slice(0, 10))
  }

  try {
    const u = new URL(data)
    const o = Object.fromEntries(u.searchParams)
    cmd = u.host
    seq = o.seq
    index = o.index
    state = o.state || 0

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

  const s = new URLSearchParams({
    seq,
    state,
    index,
    value: result
  }).toString()

  await write(`ipc://resolve?${s}`) // asking to resolve a promise
})

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

  /**
   * @param {{ window: number }} o
   */
  exit (o) {
    return ipc.request('exit', o)
  },

  /**
   * @param {{ window: number, value: string }} o
   */
  setMenu (o) {
    return ipc.request('menu', o)
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

  /**
   * @param {any} o
   */
  receive (o) {
    console.error('Receive Not Implemented', o)
    return { err: new Error('Not Implemented!') }
  }
}

module.exports = api
