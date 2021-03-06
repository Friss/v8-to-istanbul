const assert = require('assert')
const fs = require('fs')
const CovBranch = require('./branch')
const CovLine = require('./line')
const CovFunction = require('./function')

const isNode10 = !!process.version.match(/^v10/)

// Injected when Node.js is loading script into isolate pre Node 11.
// see: https://github.com/nodejs/node/pull/21573.
const cjsWrapperLength = isNode10 ? require('module').wrapper[0].length : 0

module.exports = class CovScript {
  constructor (scriptPath, wrapperLength) {
    assert(typeof scriptPath === 'string', 'scriptPath must be a string')
    const path = parsePath(scriptPath)
    this.path = path
    this.source = fs.readFileSync(path, 'utf8')
    this.wrapperLength = wrapperLength === undefined ? cjsWrapperLength : wrapperLength
    const shebangLength = this._getShebangLength()
    this.wrapperLength -= shebangLength
    this.lines = []
    this.branches = []
    this.functions = []
    this.eof = -1
    this._buildLines(this.lines, shebangLength)
  }
  _buildLines (lines, shebangLength) {
    let position = 0
    for (const [i, lineStr] of this.source.trim().split(/(?<=\r?\n)/u).entries()) {
      const matchedNewLineChar = lineStr.match(/\r?\n$/u)
      const newLineLength = matchedNewLineChar ? matchedNewLineChar[0].length : 0
      this.eof = position + lineStr.length - newLineLength
      const line = new CovLine(i + 1, position, this.eof)
      if (i === 0 && shebangLength !== 0) line.count = 1
      lines.push(line)
      position += lineStr.length
    }
  }
  applyCoverage (blocks) {
    blocks.forEach(block => {
      block.ranges.forEach((range, i) => {
        const startCol = Math.max(0, range.startOffset - this.wrapperLength)
        const endCol = Math.min(this.eof, range.endOffset - this.wrapperLength)
        const lines = this.lines.filter(line => {
          return startCol <= line.endCol && endCol >= line.startCol
        })

        if (block.isBlockCoverage && lines.length) {
          // record branches.
          this.branches.push(new CovBranch(
            lines[0],
            startCol,
            lines[lines.length - 1],
            endCol,
            range.count
          ))

          // if block-level granularity is enabled, we we still create a single
          // CovFunction tracking object for each set of ranges.
          if (block.functionName && i === 0) {
            this.functions.push(new CovFunction(
              block.functionName,
              lines[0],
              startCol,
              lines[lines.length - 1],
              endCol,
              range.count
            ))
          }
        } else if (block.functionName && lines.length) {
          // record functions.
          this.functions.push(new CovFunction(
            block.functionName,
            lines[0],
            startCol,
            lines[lines.length - 1],
            endCol,
            range.count
          ))
        }

        // record the lines (we record these as statements, such that we're
        // compatible with Istanbul 2.0).
        lines.forEach(line => {
          // make sure branch spans entire line; don't record 'goodbye'
          // branch in `const foo = true ? 'hello' : 'goodbye'` as a
          // 0 for line coverage.
          if (startCol <= line.startCol && endCol >= line.endCol) {
            line.count = range.count
          }
        })
      })
    })
  }
  toIstanbul () {
    const istanbulInner = Object.assign(
      { path: this.path },
      this._statementsToIstanbul(),
      this._branchesToIstanbul(),
      this._functionsToIstanbul()
    )
    const istanbulOuter = {}
    istanbulOuter[this.path] = istanbulInner
    return istanbulOuter
  }
  _statementsToIstanbul () {
    const statements = {
      statementMap: {},
      s: {}
    }
    this.lines.forEach((line, index) => {
      statements.statementMap[`${index}`] = line.toIstanbul()
      statements.s[`${index}`] = line.count
    })
    return statements
  }
  _branchesToIstanbul () {
    const branches = {
      branchMap: {},
      b: {}
    }
    this.branches.forEach((branch, index) => {
      branches.branchMap[`${index}`] = branch.toIstanbul()
      branches.b[`${index}`] = [branch.count]
    })
    return branches
  }
  _functionsToIstanbul () {
    const functions = {
      fnMap: {},
      f: {}
    }
    this.functions.forEach((fn, index) => {
      functions.fnMap[`${index}`] = fn.toIstanbul()
      functions.f[`${index}`] = fn.count
    })
    return functions
  }
  _getShebangLength () {
    if (this.source.indexOf('#!') === 0) {
      const match = this.source.match(/(?<shebang>#!.*)/)
      if (match) {
        return match.groups.shebang.length
      }
    } else {
      return 0
    }
  }
}

function parsePath (scriptPath) {
  return scriptPath.replace('file://', '')
}
