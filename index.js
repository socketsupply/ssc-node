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
  process.stdout.write(s + '\n')
}

console.log = (...args) => {
  const s = args.map(v => util.format(v)).join(' ')
  write(`ipc://stdout?value=${encodeURIComponent(s)}`)
}

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

ipc.request = (cmd, opts) => {
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
      index: opts.window,
      seq,
      value: opts.value || '0'
    }).toString()
  } catch (err) {
    console.error(`Cannot encode request ${err.message} (${value})`)
    return Promise.reject(err)
  }

  write(`ipc://${cmd}?${value}`)
  return promise
}

ipc.send = o => {
  const value = JSON.stringify(o.value)

  if (!value || !value.trim()) return

  const s = new URLSearchParams({
    event: o.event,
    index: o.index,
    value
  }).toString()

  write(`ipc://send?${s}`)
}

process.stdin.resume()
process.stdin.setEncoding('utf8')

process.stdin.on('data', async data => {
  let cmd = ''
  let index = 0
  let seq = 0
  let state = 0
  let value = ''

  try {
    const u = new URL(data)
    const o = Object.fromEntries(u.searchParams)
    cmd = u.host
    seq = o.seq
    index = o.index
    state = o.state || 0

    if (o.value) {
      value = JSON.parse(decodeURIComponent(o.value))
    }
  } catch (err) {
    console.log(`Unable to parse stdin message (${data})`)
    throw err
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

  write(`ipc://resolve?${s}`) // asking to resolve a promise
})

//
// Exported API
// ---
//
const api = {}

api.show = o => ipc.request('show', o)

api.navigate = o => ipc.request('navigate', o)

api.setTitle = o => ipc.request('title', o)

api.setSize = o => ipc.request('size', o)

api.setMenu = o => ipc.request('menu', o)

api.send = ipc.send

api.receive = () => 'Not Implemented!'

module.exports = api
