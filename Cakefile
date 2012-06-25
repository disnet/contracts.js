fs   = require 'fs'
path = require 'path'
{spawn} = require 'child_process'

run = (args, cb) ->
  proc =         spawn 'coffee', args
  proc.stderr.on 'data', (buffer) -> console.log buffer.toString()
  proc.on        'exit', (status) ->
    process.exit(1) if status != 0
    cb() if typeof cb is 'function'

task 'build', (options) ->
  fs.mkdirSync "build", 0o777 if not fs.existsSync "build"
  console.log "runnning"
  run ['-c', '-o', 'build/', 'src/contracts.coffee'], ->
    stacktrace = fs.readFileSync 'src/stacktrace.js', 'utf8'
    contracts = fs.readFileSync 'build/contracts.js', 'utf8'
    fs.writeFileSync 'lib/contracts.js', "#{stacktrace}\n#{contracts}"
