const V8ToIstanbul = require('./lib/v8-to-istanbul')

module.exports = function (path, wrapperLength) {
  return new V8ToIstanbul(path, wrapperLength)
}
