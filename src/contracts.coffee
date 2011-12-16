"use strict"
###
contracts.coffee
http://disnetdev.com/contracts.coffee

Copyright 2011, Tim Disney
Released under the MIT License
###
root = exports ? this.Contracts = {}

enabled = true

# contract_orig_map :: 
#   set: (Any, OrigMap) -> Undefined
#   get: (Any) -> OrigMap
contract_orig_map = new WeakMap();

class Unproxy
  constructor: ->
    if WeakMap?
      @hasWeak = yes
      @unproxy = new WeakMap()
    else
      @hasWeak = no
      @unproxy = []

  set: (p, c) ->
    if @hasWeak
      @unproxy.set p, c
    else
      @unproxy.push
        proxy: p
        contract: c

  get: (p) ->
    if @hasWeak
      if (p isnt null) and typeof p is "object" or typeof p is "function"
        @unproxy.get p
      else
        undefined
    else
      pc = @unproxy.filter (el) ->
        p is el.proxy
      throw "assumption failed: unproxy object stores multiple unique proxies"  if pc.length > 1
      if pc.length is 1
        pc[0]
      else
        undefined

unproxy = new Unproxy()

Utils =
  # walk the proto chain to get the property descriptor
  getPropertyDescriptor: (obj, prop) ->
    o = obj
    loop
      desc = Object.getOwnPropertyDescriptor(o, prop)
      return desc  if desc isnt `undefined`
      o = Object.getPrototypeOf(o)
      break unless o isnt null
    undefined

  # merges props of o2 into o1 return o1
  merge: (o1, o2) ->
    o3 = {}
    f = (o) ->
      for name of o
        o3[name] = o[name]  if o.hasOwnProperty(name)

    f o1
    f o2
    o3

  hasNoHoles: (obj) ->
    i = 0
    while i < obj.length
      return false  unless i of obj
      i++
    true

  # if a1 and a2 are differently sized, return the empty list
  zip: (a1, a2) ->
    ret = []
    if not Array.isArray(a1) or not Array.isArray(a2) or (a1.length isnt a2.length)
      ret = []
    else
      i = 0
      while i < a1.length
        ret.push [ a1[i], a2[i] ]
        i++
    ret


checkOptions = (a, b) ->
  pOpt = true
  for name of a
    if a[name] instanceof Contract
      pOpt = false  unless a[name].equals(b[name])
    else pOpt = false  if a[name] isnt b[name]
  for name of b
    pOpt = false  unless name of a
  pOpt

# Parses out filename and line number. Expects an array where the 0th entry
# is the file location and line number
# [...Str] -> [Str, Num] or null
findCallsite = (trace) ->
  t = trace[0]
  # string looks like {adsf}@file:///path/to/file.js:42
  re = /@(.*):(\d*)$/
  match = re.exec(t)
  if match
    [ match[1], parseInt(match[2], 10) ]
  else
    null

# (ModuleName, ModuleName, Str, [Contract]) -> \bot
_blame = (toblame, other, msg, parents) ->
  ps = parents.slice(0)
  server = (if toblame.isServer then toblame else other)
  m = "Contract violation: " + msg + "\n" + 
      "Value guarded in: " + server + " -- blame is on: " + toblame + "\n"

  m += "Parent contracts:\n" + ps.reverse().join("\n")  if ps

  err = new Error(m)
  st = printStackTrace(e: err)
  err.cleaned_stacktrace = st

  # pretend the error was thrown at the place in usercode where the violation occured
  callsite = findCallsite(st)
  if callsite
    # by setting these fields tools like firebug will link to the
    # appropriate place in the user code
    err.fileName = callsite[0]
    err.lineNumber = callsite[1]
  throw err

# (ModuleName, ModuleName, Contract, any, [Contract]) -> \bot
blame = (toblame, other, contract, value, parents) ->
  cname = contract.cname or contract
  msg = "expected <" + cname + ">" + 
        ", actual: " + (if typeof (value) is "string" then "\"" + value + "\"" else value)

  throw _blame(toblame, other, msg, parents)

blameM = (toblame, other, msg, parents) -> _blame toblame, other, msg, parents

# creates an identity proxy handler
idHandler = (obj) ->
  getOwnPropertyDescriptor: (name) ->
    desc = Object.getOwnPropertyDescriptor(obj, name)
    desc.configurable = true  if desc isnt undefined
    desc

  getPropertyDescriptor: (name) ->
    desc = Utils.getPropertyDescriptor(obj, name)
    desc.configurable = true  if desc
    desc

  getOwnPropertyNames: ->
    Object.getOwnPropertyNames obj

  getPropertyNames: ->
    Object.getPropertyNames obj

  defineProperty: (name, desc) ->
    Object.defineProperty obj, name, desc

  'delete': (name) ->
    delete obj[name]

  fix: ->
    if Object.isFrozen(obj)
      return Object.getOwnPropertyNames(obj).map((name) ->
        Object.getOwnPropertyDescriptor obj, name
      )
    undefined

  has: (name) ->
    name of obj

  hasOwn: (name) ->
    Object::hasOwnProperty.call obj, name

  enumerate: ->
    result = []
    name = undefined
    for name of obj
      result.push name
    result

  get: (receiver, name) ->
    obj[name]

  set: (receiver, name, val) ->
    obj[name] = val
    true

  keys: ->
    Object.keys obj


class Contract
  constructor: (@cname, @ctype, @handler) ->
    @parent = null

  check: (val, pos, neg, parentKs, stack) ->
    c = unproxy.get val
    if c and c.equals @
      # don't bother wrapping twice though we want to run the handler
      # for the initialization check that happens and just ignore the return
      @handler val, pos, neg, parentKs, stack
      val
    else
      @handler val, pos, neg, parentKs, stack

  toContract: -> @
  toString: -> @cname
  equals: (other) -> throw "Equality checking must be overridden"

class ModuleName 
  constructor: (@filename, @linenum, @isServer) ->
  toString: -> @filename + (if @linenum is "" then "" else (":" + @linenum))

Function::toContract = ->
  name = "<user defined: " + @toString() + ">"
  check this, name

# create a flat (predicate) contract
check = (p, name) ->
  c = new Contract name, "check", (val, pos, neg, parentKs, stack) ->
    if p(val, stack)
      val
    else
      blame pos, neg, this, val, parentKs

  c.equals = (other) ->
    (@cname is other.cname) and (@handler is other.handler)
  c

# create a function contract
fun = (dom, rng, options) ->
  cleanDom = (dom) ->
    # wrap the domain in array so we can be consistent
    dom = [ dom ]  if dom instanceof Contract
    # don't allow required argument contracts to follow optional
    dom.reduce ((prevWasOpt, curr) ->
      if curr.ctype is "opt"
        true
      else
        if prevWasOpt
          throw "Illagal arguments: required argument following an optional argument."
        else
          false
    ), false
    dom

  # dom is overloaded so check if was called as
  # an object with the contracts for call/new
  if dom and dom.call and dom["new"]
    # different rng/dom for call/new
    calldom = cleanDom(dom.call[0])
    callrng = dom.call[1]
    newdom = cleanDom(dom["new"][0])
    newrng = dom["new"][1]
    options = rng or {}
  else
    # rng/dom for call/new are the same
    calldom = cleanDom(dom)
    callrng = rng
    newdom = calldom
    newrng = callrng
    options = options or {}

  callOnly = options and options.callOnly
  newOnly = options and options.newOnly

  throw "Cannot have a function be both newOnly and newSafe"  if callOnly and newOnly
  throw "Illegal arguments: cannot have both newOnly and a contract on 'this'"  if newOnly and options["this"]

  domName = "(" + calldom.join(",") + ")"
  optionsName = (if options["this"] then "{this: " + options["this"].cname + "}" else "")
  contractName = domName + " -> " + callrng.cname + " " + optionsName

  c = new Contract(contractName, "fun", (f, pos, neg, parentKs, stack) ->
    handler = idHandler f
    that = this
    parents = parentKs.slice(0)
    blame pos, neg, this, f, parents  if typeof f isnt "function"

    parents.push that

    ###
    options:
      isNew: Bool   - make a constructor handler (to be called with new)
      newSafe: Bool - make call handler that adds a call to new
      pre: ({} -> Bool) - function to check preconditions
      post: ({} -> Bool) - function to check postconditions
      this: {...} - object contract to check 'this'
    ###
    makeHandler = (dom, rng, options) ->
      functionHandler = ->
        args = []

        if options and options.checkStack and not (options.checkStack(stack))
          throw new Error("stack checking failed")  

        if typeof options.pre is "function" and not options.pre this
          # check pre condition
          blame neg, pos, 
            "precondition: " + options.pre.toString(), 
            "[failed precondition]", parents  

        # check all the arguments
        i = 0
        while i < dom.length
          # might pass through undefined which is fine (opt will take
          # care of it if the argument is actually optional)
          # 
          # blame is reversed
          args[i] = dom[i].check(arguments[i], neg, pos, parents, stack)
          # assigning back to args since we might be wrapping functions/objects
          # in delayed contracts
          i++

        if typeof rng is "function"
          # send the arguments to the dependent range
          clean_rng = rng.apply(this, args)
        else
          clean_rng = rng

        # apply the function and check its result
        if options.isNew or options.newSafe
          # null is in the 'this' argument position for bind...
          # bind will ignore the supplied 'this' when we call it with new 
          boundArgs = [].concat.apply([ null ], args)
          bf = f.bind.apply(f, boundArgs)
          res = new bf()
          res = clean_rng.check(res, pos, neg, parents, stack)
        else
          if options.this
            # blame is reversed
            thisc = options.this.check(this, neg, pos, parents, stack)
          else
            thisc = this
          res = clean_rng.check(f.apply(thisc, args), pos, neg, parents, stack)

        # check post condition
        if typeof options.post is "function" and not options.post this
          blame neg, pos, 
            "failed postcondition: " + options.post.toString(), 
            "[failed postcondition]", parents  
        res

    if newOnly
      options.isNew = true
      callHandler = -> blameM neg, pos, "called newOnly function without new", parents
      newHandler = makeHandler(@newdom, @newrng, options)
    else if callOnly
      options.isNew = false
      newHandler = -> blameM neg, pos, "called callOnly function with a new", parents
      callHandler = makeHandler(@calldom, @callrng, options)
    else # both false...both true is a contract construction-time error and handled earlier
      callHandler = makeHandler(@calldom, @callrng, options)
      newHandler = makeHandler(@newdom, @newrng, options)

    p = Proxy.createFunction(handler, callHandler, newHandler)
    unproxy.set p, this
    p
  )
  c.calldom = calldom
  c.callrng = callrng
  c.newdom = newdom
  c.newrng = newrng
  c.raw_options = options
  c.equals = (other) ->
    # can can short circuit here if we're not testing against another contract
    return false  if not other instanceof Contract or other.ctype isnt @ctype

    zipCDom = Utils.zip(@calldom, other.calldom)
    zipNDom = Utils.zip(@newdom, other.newdom)

    pCDom = (zipCDom.length isnt 0) and zipCDom.every (zd) -> zd[0].equals zd[1]
    pNDom = (zipNDom.length isnt 0) and zipNDom.every (zd) -> zd[0].equals zd[1]

    # this will "fail" equality testing if the options object has
    # pre/post functions that are the "same" but not the same reference
    pOpt = checkOptions(@raw_options, other.raw_options)

    pOpt and pCDom and pNDom and (@callrng.equals(other.callrng)) and (@newrng.equals(other.newrng))
  c

ctor = (dom, rng, options) ->
  opt = Utils.merge options,
    newOnly: true

  fun dom, rng, opt

ctorSafe = (dom, rng, options) ->
  opt = Utils.merge options,
    newSafe: true

  fun dom, rng, opt


object = (objContract, options = {}, name) ->
  objName = (obj) ->
    if name is undefined
      props = Object.keys(obj).map (propName) ->
        if obj[propName].cname
          propName + " : " + obj[propName].cname
        else
          propName + " : " + obj[propName].value.cname
      , this

      "{" + props.join(", ") + "}"
    else
      name

  c = new Contract(objName(objContract), "object", (obj, pos, neg, parentKs) ->
    handler = idHandler obj
    that = this
    parents = parentKs.slice(0)
    parents.push this

    if not obj instanceof Object
      blame pos, neg, this, obj, parentKs 

    if options.extensible is true and not Object.isExtensible(obj)
      blame pos, neg, "[extensible object]", "[non-extensible object]", parents  

    if options.extensible is false and Object.isExtensible(obj)
      blame pos, neg, "[non-extensible]", "[extensible object]", parents  

    if options.sealed is true and not Object.isSealed(obj)
      blame pos, neg, "[sealed object]", "[non-sealed object]", parents  

    if options.sealed is false and Object.isSealed(obj)
      blame pos, neg, "[non-sealed object]", "[sealed object]", parents  

    if options.frozen is true and not Object.isFrozen(obj)
      blame pos, neg, "[frozen object]", "[non-frozen object]", parents  

    if options.frozen is false and Object.isFrozen(obj)
      blame pos, neg, "[non-frozen object]", "[frozen object]", parents  

    # do some cleaning of the object contract...
    # in particular wrap all object contract in a prop descriptor like object
    # for symmetry with user defined contract property
    # descriptors: object({ a: Num }) ==> object({ a: {value: Num} })
    for prop of @oc
      # todo: commenting out for now to allow us to have an object contract prototype chain
      # only reason not too allow this is if the user puts something silly on the chain. 
      # if(!this.oc.hasOwnProperty(prop)) {
      #     continue; 
      # }
      contractDesc = @oc[prop]
      objDesc = Utils.getPropertyDescriptor(obj, prop)

      # pull out the contract (might be direct or in a descriptor like {value: Str, writable: true})
      if contractDesc instanceof Contract
        value = contractDesc
      else
        # case when defined as a contract property descriptor
        if contractDesc["value"]
          value = contractDesc["value"]
        # something other than a descriptor
        else
          blameM pos, neg, "contract property descriptor missing value property", parents

      if objDesc
        # check the contract descriptors agains what is actually on the object
        # and blame where apropriate
        if contractDesc.writable is true and not objDesc.writable
          blame pos, neg, "[writable property: #{prop}]", "[read-only property: #{prop}]", parents

        if contractDesc.writable is false and objDesc.writable
          blame pos, neg, "[read-only property: #{prop}]", "[writable property: #{prop}]", parents  

        if contractDesc.configurable is true and not objDesc.configurable
          blame pos, neg, "[configurable property: #{prop}]", "[non-configurable property: #{prop}]", parents  

        if contractDesc.configurable is false and objDesc.configurable
          blame pos, neg, "[non-configurable property: #{prop}]", "[configurable property: #{prop}]", parents  

        if contractDesc.enumerable is true and not objDesc.enumerable
          blame pos, neg, "[enumerable property: #{prop}]", "[non-enumerable property: #{prop}]", parents  

        if contractDesc.enumerable is false and objDesc.enumerable
          blame pos, neg, "[non-enumerable property: #{prop}]", "[enumerable property: #{prop}]", parents  

        # contract descriptors default to the descriptor on the value unless
        # explicitly specified by the contrac 
        @oc[prop] =
          value: value
          writable: contractDesc.writable or objDesc.writable
          configurable: contractDesc.configurable or objDesc.configurable
          enumerable: contractDesc.enumerable or objDesc.enumerable
      else
        # property does not exist but we have a contract for it
        if value.ctype is "opt"
          # the opt contract allows a property to be optional
          # so just put in the contract with all the prop descriptors set to true
          @oc[prop] =
            value: value
            writable: true
            configurable: true
            enumerable: true
        else
          blame pos, neg, this, "[missing property: #{prop}]", parents

    # check object invariant
    if options.invariant
      invariant = options.invariant.bind(obj)
      blame neg, pos, "invariant: #{options.invariant.toString()}", obj, parents  unless invariant()

    handler.defineProperty = (name, desc) ->
      # note: we coulad have also allowed a TypeError to be thrown by the system
      # if in strict mode or silengtly fail otherwise but we're using the blame system
      # for hopfully better error messaging
      if (options.extensible is false) or options.sealed or options.frozen
        # have to reverse blame since the client is the one calling defineProperty
        blame neg, pos, "[non-extensible object]", 
          "[attempted to change property descriptor of: #{name}]", parents  

      if not that.oc[name].configurable
        blame neg, pos, "[non-configurable property: #{name}]", 
          "[attempted to change the property descriptor of property: #{name}]", parents  

      Object.defineProperty obj, name, desc

    handler["delete"] = (name) ->
      res = undefined
      invariant = undefined
      # have to reverse blame since the client is the one calling delete
      if options.sealed or options.frozen
        blame neg, pos, "#{if options.sealed then 'sealed' else 'frozen'} object", 
          "[call to delete]", parents  

      res = delete obj[name]

      if options.invariant
        invariant = options.invariant.bind(obj)
        blame neg, pos, "invariant: #{options.invariant.toString()}", obj, parents  unless invariant()

    handler["get"] = (receiver, name) ->
      if that.oc.hasOwnProperty(name)
        that.oc[name].value.check obj[name], pos, neg, parents
      else if (options.arrayRangeContract and (options.arrayRange isnt `undefined`)) and (parseInt(name, 10) >= options.arrayRange)
        options.arrayRangeContract.check obj[name], pos, neg, parents
      else
        obj[name]

    handler.set = (receiver, name, val) ->
      if (options.extensible is false) and Object.getOwnPropertyDescriptor(obj, name) is undefined
        blame neg, pos, "non-extensible object", "[attempted to set a new property: #{name}]", parents  

      if options.frozen
        blame neg, pos, "frozen object", "[attempted to set: #{name}]", parents  

      if that.oc.hasOwnProperty(name)
        if not that.oc[name].writable
          blame neg, pos, "read-only property", "[attempted to set read-only property: #{name}]", parents  
        # have to reverse blame since the client is the one calling set
        obj[name] = that.oc[name]["value"].check(val, neg, pos, parents)
      else if (options.arrayRangeContract and (options.arrayRange isnt undefined)) and (parseInt(name, 10) >= options.arrayRange)
        obj[name] = options.arrayRangeContract.check(val, neg, pos, parents)
      else
        obj[name] = val
      if options.invariant
        invariant = options.invariant.bind(obj)
        blame neg, pos, "invariant: #{options.invariant.toString()}", obj, parents  unless invariant()
      true

    # making this a function proxy if object is also a
    # function to preserve typeof checks
    if typeof obj is "function"
      op = Proxy.createFunction(handler, (args) ->
        obj.apply this, arguments
      , (args) ->
        boundArgs = [].concat.apply([ null ], arguments)
        bf = obj.bind.apply(obj, boundArgs)
        new bf()
      )
    else
      op = Proxy.create(handler, Object::)
    unproxy.set op, this
    op
  )

  c.oc = objContract
  c.raw_options = options


  # hook up the recursive contracts if they exist
  setSelfContracts = (c, toset) ->
    # all the different possible children names from the combinators (really kludgy)
    childrenNames = [ "k", "k1", "k2", "flats", "ho", "calldom", "callrng", "newdom", "newrng" ]
    # check each of the properties in an object contract
    if typeof c.oc isnt "undefined"
      for name of c.oc
        # if this prop is the self contract replace it with the contract reference
        if c.oc[name] is self
          c.oc[name] = toset
        # otherwise if it's a function contract then there might be nested
        # self contracts so dive into them with the original toset reference
        else 
          setSelfContracts c.oc[name], toset  if c.oc[name].ctype isnt "object"
        # note that we don't dive into object contracts...each self contract
        # thus binds to its enclosing object contract
    else
      # run through each of the children contracts (sorry, pretty kludgy)
      childrenNames.forEach (cName) ->
        if typeof c[cName] isnt "undefined"
          # the if stored in an array go through those first
          if Array.isArray(c[cName])
            i = 0
            while i < c[cName].length
              if c[cName][i] is self
                c[cName][i] = toset
              else 
                # dive into nested contracts with the original toset reference
                setSelfContracts c[cName][i], toset  if c[cName][i].ctype isnt "object"
              i++
          else
            if c[cName] is self
              c[cName] = toset
            else setSelfContracts c[cName], toset  if c[cName] isnt "object"


  setSelfContracts c, c
  c.equals = (other) ->
    return false  if not other instanceof Contract or other.ctype isnt @ctype
    checkOptions(@oc, other.oc) and checkOptions(@raw_options, other.raw_options)
  c


arr = (ks) ->
  # todo might make sense to allow var args along with array arguments
  oc = {}
  name = ""
  prefix = ""
  i = 0
  while i < ks.length
    prefix = ", "  if i isnt 0
    if typeof ks[i] is "function"
      throw "___() must be at the last position in the array"  if i isnt ks.length - 1
      rangeContract = ks[i]()
      rangeIndex = i
      name += prefix + "..." + rangeContract.cname
    else
      oc[i] = ks[i]
      name += prefix + ks[i].cname
    i++
  name = "[" + name + "]"
  object oc,
    arrayRange: rangeIndex
    arrayRangeContract: rangeContract
  , name

___ = (k) -> (-> k)

or_ = ->
  ks = [].slice.call(arguments)

  flats = ks.filter (el) -> el.ctype is "check"
  ho = ks.filter (el) -> el.ctype isnt "check"
  throw "Cannot have more than 1 higher order contract in 'or'"  if ho.length > 1

  name = ks.join(" or ")
  c = new Contract(name, "or", (val, pos, neg, parentKs) ->
    parents = parentKs.slice(0)
    parents.push this

    i = 0
    while i < flats.length
      try
        return @flats[i].check(val, pos, neg, parents)
      catch e
        lastBlame = e
        i++

    if ho.length is 1
      @ho[0].check val, pos, neg, parents
    else
      throw lastBlame # the last contract in the array still assigned blame so surface it
  )

  c.flats = flats
  c.ho = ho
  c.equals = (other) ->
    return false  if not other instanceof Contract or other.ctype isnt @ctype
    zipFlats = Utils.zip(@flats, other.flats)
    pFlats = (zipFlats.length isnt 0) and zipFlats.every((zf) ->
      zf[0].equals zf[1]
    )
    pFlats and (@ho.equals(other.ho))
  c

and_ = (k1, k2) ->
  c = new Contract "#{k1.cname} and #{k2.cname}", "and", (val, pos, neg, parentKs) ->
    k1c = k1.check(val, pos, neg, parentKs)
    k2.check k1c, pos, neg, parentKs

  c.k1 = k1
  c.k2 = k2

  c.equals = (other) ->
    return false  if not other instanceof Contract or other.ctype isnt @ctype
    (@k1.equals(other.k1)) and (@k2.equals(other.k2))

  c

not_ = (k) ->
  throw "cannot construct a 'not' contract with a function or object contract"  if k.ctype is "fun" or k.ctype is "object"

  c = new Contract "not #{k.cname}", "not", (val, pos, neg, parentKs) ->
    try
      res = @k.check(val, pos, neg, parentKs)
      blame pos, neg, this, val, parentKs
    catch b
      # inverting the original contract so return ok
      return res

  c.k = k

  c.equals = (other) ->
    return false  if not other instanceof Contract or other.ctype isnt @ctype
    @k.equals other.k
  c

opt = (k) ->
  c = new Contract "opt(#{k.cname})", "opt", (val, pos, neg, parentKs) ->
    if val is undefined
      # unsuplied arguments are just passed through
      val
    else
      # arg is actually something so check the underlying contract
      @k.check val, pos, neg, parentKs

  c.k = k
  c.equals = (other) ->
    return false  if not other instanceof Contract or other.ctype isnt @ctype
    @k.equals other.k
  c

# note that this function is particular about where it is called from.
# it gets the filename/linenum combo from the file that called the
# function that called getModName (two levels up the stack).
# () -> ModuleName
getModName = (isServer) ->
  st = printStackTrace(e: new Error())
  # in the stacktrace the frame above this one is where we were guarded/used
  guardedAt = st[2]
  # pull out the filename (which will become our module) and line 
  # number (the location in the module where the guard/use occured)
  # stack traces look like: {anonymous}()@file:///Path/to/file.js:4242
  match = /\/([^\/]*):(\d*)[\)]?$/.exec(guardedAt)

  if match
    filename = match[1]
    linenum = match[2]
  else
    filename = "unknown"
    linenum = "-1"

  new ModuleName(filename, linenum, isServer)

guard = (k, x, server, setup) ->
  stack = []
  setup stack  if typeof setup is "function"
  unless server?
    # if a server wasn't provied, guess if from the stacktrace
    server = getModName(true)
  else
    server = new ModuleName(server, "", true)

  client = new ModuleName server.filename, "#{server.linenum} (caller)", false
  server.linenum = "#{server.linenum} (value)"

  # unless k is just a first-order contract, c will be a proxy
  c = k.check x, server, client, [], stack
  
  # in the future we can get back the uncontracted value and contract if
  # given the contracted value (for use in module wrangling)
  contract_orig_map.set c, {originalValue: x, originalContract: k, server: "", }

  if not enabled then x else c

any = (->
  c = new Contract("any", "any", (val) ->
    val
  )
  c.equals = (other) ->
    this is other
  c
)()

self = (->
  c = new Contract("self", "self", (val) ->
    val
  )
  c.equals = (other) ->
    this is other
  c
)()

none = (->
  c = new Contract("none", "none", (val, pos, neg, parentKs) ->
    blame pos, neg, this, val, parentKs
  )
  c.equals = (other) ->
    this is other
  c
)()

# contracts
root.Undefined = check ((x) -> undefined is x), "Undefined"
root.Null      = check ((x) -> null is x), "Null"
root.Num       = check ((x) -> typeof (x) is "number"), "Num"
root.Bool      = check ((x) -> typeof (x) is "boolean"), "Bool"
root.Str       = check ((x) -> typeof (x) is "string"), "Str"
root.Odd       = check ((x) -> (x % 2) is 1), "Odd"
root.Even      = check ((x) -> (x % 2) isnt 1), "Even"
root.Pos       = check ((x) -> x >= 0), "Pos"
root.Nat       = check ((x) -> x > 0), "Nat"
root.Neg       = check ((x) -> x < 0), "Neg"
root.Arr       = object(length: check ((x) -> typeof (x) is "number"), "Number")
root.Self      = self
root.Any       = any
root.None      = none
# combinators
root.check     = check
root.fun       = fun
root.ctor      = ctor
root.ctorSafe  = ctorSafe
root.object    = object
root.arr       = arr
root.___       = ___
root.any       = any
root.or        = or_
root.none      = none
root.not       = not_
root.and       = and_
root.opt       = opt
root.guard     = guard
# utility functios
# root.makeContractExports :: (Str, {}?) -> {}
root.makeContractsExports = (moduleName, original = {}) -> 
  handler = idHandler original
  handler.set = (r, name, value) ->
    {originalValue, originalContract} = contract_orig_map.get value
    if originalValue?
      # make a note of the server's module name name in the map
      contract_orig_map.set value, 
        originalValue: originalValue
        originalContract: originalContract
        server: moduleName
    original[name] = value
    return
  Proxy.create handler

# root.use :: ({}, Str) -> {}
root.use = (exportObj, moduleName) ->
  res = {}
  for own name, value of exportObj
    orig = contract_orig_map.get value
    if orig?
      # apply the original contract with our client's module name
      res[name] = orig.originalContract.check orig.originalValue, orig.server, moduleName, []
    else
      res[name] = value
  res
root.enabled = (b) -> enabled = b
# puts every exported function onto the global scope
root.autoload  = ->
  globalObj = window ? global # browser or node
  globalObj[name] = root[name] for own name of root
  return
    