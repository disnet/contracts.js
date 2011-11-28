Contracts = (->
  checkOptions = (a, b) ->
    name = undefined
    pOpt = true
    for name of a
      if a[name] instanceof Contract
        pOpt = false  unless a[name].equals(b[name])
      else pOpt = false  if a[name] isnt b[name]
    for name of b
      pOpt = false  unless name of a
    pOpt
  findCallsite = (trace) ->
    match = undefined
    t = trace[0]
    re = /@(.*):(\d*)$/
    match = re.exec(t)
    if match
      [ match[1], parseInt(match[2], 10) ]
    else
      null
  _blame = (toblame, other, msg, parents) ->
    server = undefined
    err = undefined
    st = undefined
    callsite = undefined
    ps = parents.slice(0)
    server = (if toblame.isServer then toblame else other)
    m = "Contract violation: " + msg + "\n" + "Value guarded in: " + server + " -- blame is on: " + toblame + "\n"
    m += "Parent contracts:\n" + ps.reverse().join("\n")  if ps
    err = new Error(m)
    st = printStackTrace(e: err)
    err.cleaned_stacktrace = st
    callsite = findCallsite(st)
    if callsite
      err.fileName = callsite[0]
      err.lineNumber = callsite[1]
    throw err
  blame = (toblame, other, contract, value, parents) ->
    cname = contract.cname or contract
    msg = "expected <" + cname + ">" + ", actual: " + (if typeof (value) is "string" then "\"" + value + "\"" else value)
    throw _blame(toblame, other, msg, parents)
  blameM = (toblame, other, msg, parents) ->
    _blame toblame, other, msg, parents
  idHandler = (obj) ->
    getOwnPropertyDescriptor: (name) ->
      desc = Object.getOwnPropertyDescriptor(obj, name)
      desc.configurable = true  if desc isnt `undefined`
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

    delete: (name) ->
      delete obj[name]

    fix: ->
      if Object.isFrozen(obj)
        return Object.getOwnPropertyNames(obj).map((name) ->
          Object.getOwnPropertyDescriptor obj, name
        )
      `undefined`

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
  Contract = (cname, ctype, handler) ->
    @handler = handler
    @cname = cname
    @ctype = ctype
    @parent = null
  ModuleName = (filename, linenum, isServer) ->
    @filename = filename
    @linenum = linenum
    @isServer = isServer
  check = (p, name) ->
    c = undefined
    c = new Contract(name, "check", check = (val, pos, neg, parentKs, stack) ->
      if p(val, stack)
        val
      else
        blame pos, neg, this, val, parentKs
    )
    c.equals = (other) ->
      (@cname is other.cname) and (@handler is other.handler)

    c
  fun = (dom, rng, options) ->
    callOnly = undefined
    newOnly = undefined
    cleanDom = undefined
    domName = undefined
    optionsName = undefined
    contractName = undefined
    newdom = undefined
    newrng = undefined
    calldom = undefined
    callrng = undefined
    c = undefined
    cleanDom = (dom) ->
      dom = [ dom ]  if dom instanceof Contract
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

    if dom and dom.call and dom["new"]
      calldom = cleanDom(dom.call[0])
      callrng = dom.call[1]
      newdom = cleanDom(dom["new"][0])
      newrng = dom["new"][1]
      options = rng or {}
    else
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
      callHandler = undefined
      newHandler = undefined
      handler = idHandler(f)
      that = this
      parents = parentKs.slice(0)
      p = undefined
      blame pos, neg, this, f, parents  if typeof f isnt "function"
      parents.push that
      makeHandler = (dom, rng, options) ->
        functionHandler = ->
          i = undefined
          res = undefined
          args = []
          boundArgs = undefined
          bf = undefined
          thisc = undefined
          clean_rng = undefined
          throw new Error("stack checking failed")  if options and options.checkStack and not (options.checkStack(stack))
          blame neg, pos, "precondition: " + options.pre.toString(), "[failed precondition]", parents  unless options.pre(this)  if typeof options.pre is "function"
          i = 0
          while i < dom.length
            args[i] = dom[i].check(arguments[i], neg, pos, parents, stack)
            i++
          if typeof rng is "function"
            clean_rng = rng.apply(this, args)
          else
            clean_rng = rng
          if options.isNew or options.newSafe
            boundArgs = [].concat.apply([ null ], args)
            bf = f.bind.apply(f, boundArgs)
            res = new bf()
            res = clean_rng.check(res, pos, neg, parents, stack)
          else
            if options["this"]
              thisc = options["this"].check(this, neg, pos, parents, stack)
            else
              thisc = this
            res = clean_rng.check(f.apply(thisc, args), pos, neg, parents, stack)
          blame neg, pos, "failed postcondition: " + options.post.toString(), "[failed postcondition]", parents  unless options.post(this)  if typeof options.post is "function"
          res

      if newOnly
        options.isNew = true
        callHandler = ->
          blameM neg, pos, "called newOnly function without new", parents

        newHandler = makeHandler(@newdom, @newrng, options)
      else if callOnly
        options.isNew = false
        newHandler = ->
          blameM neg, pos, "called callOnly function with a new", parents

        callHandler = makeHandler(@calldom, @callrng, options)
      else
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
      name = undefined
      zipCDom = undefined
      zipNDom = undefined
      pCDom = undefined
      pNDom = undefined
      pOpt = undefined
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      zipCDom = Utils.zip(@calldom, other.calldom)
      zipNDom = Utils.zip(@newdom, other.newdom)
      pCDom = (zipCDom.length isnt 0) and zipCDom.every((zd) ->
        zd[0].equals zd[1]
      )
      pNDom = (zipNDom.length isnt 0) and zipNDom.every((zd) ->
        zd[0].equals zd[1]
      )
      pOpt = checkOptions(@raw_options, other.raw_options)
      pOpt and pCDom and pNDom and (@callrng.equals(other.callrng)) and (@newrng.equals(other.newrng))

    c
  ctor = (dom, rng, options) ->
    opt = Utils.merge(options,
      newOnly: true
    )
    fun dom, rng, opt
  ctorSafe = (dom, rng, options) ->
    opt = Utils.merge(options,
      newSafe: true
    )
    fun dom, rng, opt
  object = (objContract, options, name) ->
    setSelfContracts = (c, toset) ->
      i = undefined
      name = undefined
      childrenNames = [ "k", "k1", "k2", "flats", "ho", "calldom", "callrng", "newdom", "newrng" ]
      if typeof c.oc isnt "undefined"
        for name of c.oc
          if c.oc[name] is self
            c.oc[name] = toset
          else setSelfContracts c.oc[name], toset  if c.oc[name].ctype isnt "object"
      else
        childrenNames.forEach (cName) ->
          if typeof c[cName] isnt "undefined"
            if Array.isArray(c[cName])
              i = 0
              while i < c[cName].length
                if c[cName][i] is self
                  c[cName][i] = toset
                else setSelfContracts c[cName][i], toset  if c[cName][i].ctype isnt "object"
                i++
            else
              if c[cName] is self
                c[cName] = toset
              else setSelfContracts c[cName], toset  if c[cName] isnt "object"
    options = options or {}
    objName = (obj) ->
      if name is `undefined`
        props = Object.keys(obj).map((propName) ->
          if obj[propName].cname
            propName + " : " + obj[propName].cname
          else
            propName + " : " + obj[propName].value.cname
        , this)
        "{" + props.join(", ") + "}"
      else
        name

    c = new Contract(objName(objContract), "object", (obj, pos, neg, parentKs) ->
      missingProps = undefined
      op = undefined
      i = undefined
      prop = undefined
      contractDesc = undefined
      objDesc = undefined
      value = undefined
      handler = idHandler(obj)
      that = this
      parents = parentKs.slice(0)
      invariant = undefined
      parents.push this
      blame pos, neg, this, obj, parentKs  unless obj instanceof Object
      blame pos, neg, "[extensible object]", "[non-extensible object]", parents  if options.extensible is true and not Object.isExtensible(obj)
      blame pos, neg, "[non-extensible]", "[extensible object]", parents  if options.extensible is false and Object.isExtensible(obj)
      blame pos, neg, "[sealed object]", "[non-sealed object]", parents  if options.sealed is true and not Object.isSealed(obj)
      blame pos, neg, "[non-sealed object]", "[sealed object]", parents  if options.sealed is false and Object.isSealed(obj)
      blame pos, neg, "[frozen object]", "[non-frozen object]", parents  if options.frozen is true and not Object.isFrozen(obj)
      blame pos, neg, "[non-frozen object]", "[frozen object]", parents  if options.frozen is false and Object.isFrozen(obj)
      for prop of @oc
        contractDesc = @oc[prop]
        objDesc = Utils.getPropertyDescriptor(obj, prop)
        if contractDesc instanceof Contract
          value = contractDesc
        else
          if contractDesc["value"]
            value = contractDesc["value"]
          else
            blameM pos, neg, "contract property descriptor missing value property", parents
        if objDesc
          blame pos, neg, "[writable property: " + prop + "]", "[read-only property: " + prop + "]", parents  if contractDesc.writable is true and not objDesc.writable
          blame pos, neg, "[read-only property: " + prop + "]", "[writable property: " + prop + "]", parents  if contractDesc.writable is false and objDesc.writable
          blame pos, neg, "[configurable property: " + prop + "]", "[non-configurable property: " + prop + "]", parents  if contractDesc.configurable is true and not objDesc.configurable
          blame pos, neg, "[non-configurable property: " + prop + "]", "[configurable property: " + prop + "]", parents  if contractDesc.configurable is false and objDesc.configurable
          blame pos, neg, "[enumerable property: " + prop + "]", "[non-enumerable property: " + prop + "]", parents  if contractDesc.enumerable is true and not objDesc.enumerable
          blame pos, neg, "[non-enumerable property: " + prop + "]", "[enumerable property: " + prop + "]", parents  if contractDesc.enumerable is false and objDesc.enumerable
          @oc[prop] =
            value: value
            writable: contractDesc.writable or objDesc.writable
            configurable: contractDesc.configurable or objDesc.configurable
            enumerable: contractDesc.enumerable or objDesc.enumerable
        else
          if value.ctype is "opt"
            @oc[prop] =
              value: value
              writable: true
              configurable: true
              enumerable: true
          else
            blame pos, neg, this, "[missing property: " + prop + "]", parents
      if options.invariant
        invariant = options.invariant.bind(obj)
        blame neg, pos, "invariant: " + options.invariant.toString(), obj, parents  unless invariant()
      handler.defineProperty = (name, desc) ->
        blame neg, pos, "[non-extensible object]", "[attempted to change property descriptor of: " + name + "]", parents  if (options.extensible is false) or options.sealed or options.frozen
        blame neg, pos, "[non-configurable property: " + name + "]", "[attempted to change the property descriptor of property: " + name + "]", parents  unless that.oc[name].configurable
        Object.defineProperty obj, name, desc

      handler["delete"] = (name) ->
        res = undefined
        invariant = undefined
        blame neg, pos, (if options.sealed then "sealed" else "frozen") + " object", "[call to delete]", parents  if options.sealed or options.frozen
        res = delete obj[name]

        if options.invariant
          invariant = options.invariant.bind(obj)
          blame neg, pos, "invariant: " + options.invariant.toString(), obj, parents  unless invariant()

      handler["get"] = (receiver, name) ->
        if that.oc.hasOwnProperty(name)
          that.oc[name].value.check obj[name], pos, neg, parents
        else if (options.arrayRangeContract and (options.arrayRange isnt `undefined`)) and (parseInt(name, 10) >= options.arrayRange)
          options.arrayRangeContract.check obj[name], pos, neg, parents
        else
          obj[name]

      handler.set = (receiver, name, val) ->
        invariant = undefined
        blame neg, pos, "non-extensible object", "[attempted to set a new property: " + name + "]", parents  if (options.extensible is false) and Object.getOwnPropertyDescriptor(obj, name) is `undefined`
        blame neg, pos, "frozen object", "[attempted to set: " + name + "]", parents  if options.frozen
        if that.oc.hasOwnProperty(name)
          blame neg, pos, "read-only property", "[attempted to set read-only property: " + name + "]", parents  unless that.oc[name].writable
          obj[name] = that.oc[name]["value"].check(val, neg, pos, parents)
        else if (options.arrayRangeContract and (options.arrayRange isnt `undefined`)) and (parseInt(name, 10) >= options.arrayRange)
          obj[name] = options.arrayRangeContract.check(val, neg, pos, parents)
        else
          obj[name] = val
        if options.invariant
          invariant = options.invariant.bind(obj)
          blame neg, pos, "invariant: " + options.invariant.toString(), obj, parents  unless invariant()
        true

      if typeof obj is "function"
        op = Proxy.createFunction(handler, (args) ->
          obj.apply this, arguments
        , (args) ->
          boundArgs = undefined
          bf = undefined
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
    setSelfContracts c, c
    c.equals = (other) ->
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      checkOptions(@oc, other.oc) and checkOptions(@raw_options, other.raw_options)

    c
  arr = (ks) ->
    i = undefined
    rangeContract = undefined
    rangeIndex = undefined
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
  ___ = (k) ->
    ->
      k
  or = ->
    c = undefined
    ks = undefined
    name = undefined
    flats = undefined
    ho = undefined
    ks = [].slice.call(arguments)
    flats = ks.filter((el) ->
      el.ctype is "check"
    )
    ho = ks.filter((el) ->
      el.ctype isnt "check"
    )
    throw "Cannot have more than 1 higher order contract in 'or'"  if ho.length > 1
    name = ks.join(" or ")
    c = new Contract(name, "or", (val, pos, neg, parentKs) ->
      i = undefined
      lastBlame = undefined
      parents = parentKs.slice(0)
      parents.push this
      i = 0
      while i < flats.length
        try
          return @flats[i].check(val, pos, neg, parents)
        catch e
          lastBlame = e
          continue
        i++
      if ho.length is 1
        @ho[0].check val, pos, neg, parents
      else
        throw lastBlame
    )
    c.flats = flats
    c.ho = ho
    c.equals = (other) ->
      zipFlats = undefined
      pFlats = undefined
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      zipFlats = Utils.zip(@flats, other.flats)
      pFlats = (zipFlats.length isnt 0) and zipFlats.every((zf) ->
        zf[0].equals zf[1]
      )
      pFlats and (@ho.equals(other.ho))

    c
  and = (k1, k2) ->
    c = undefined
    c = new Contract(k1.cname + " and " + k2.cname, "and", (val, pos, neg, parentKs) ->
      k1c = k1.check(val, pos, neg, parentKs)
      k2.check k1c, pos, neg, parentKs
    )
    c.k1 = k1
    c.k2 = k2
    c.equals = (other) ->
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      (@k1.equals(other.k1)) and (@k2.equals(other.k2))

    c
  not = (k) ->
    c = undefined
    res = undefined
    throw "cannot construct a 'not' contract with a function or object contract"  if k.ctype is "fun" or k.ctype is "object"
    c = new Contract("not " + k.cname, "not", (val, pos, neg, parentKs) ->
      try
        res = @k.check(val, pos, neg, parentKs)
        blame pos, neg, this, val, parentKs
      catch b
        return res
    )
    c.k = k
    c.equals = (other) ->
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      @k.equals other.k

    c
  opt = (k) ->
    c = undefined
    c = new Contract("opt(" + k.cname + ")", "opt", (val, pos, neg, parentKs) ->
      if val is `undefined`
        val
      else
        @k.check val, pos, neg, parentKs
    )
    c.k = k
    c.equals = (other) ->
      return false  if not other instanceof Contract or other.ctype isnt @ctype
      @k.equals other.k

    c
  getModName = (isServer) ->
    guardedAt = undefined
    match = undefined
    filename = undefined
    linenum = undefined
    st = printStackTrace(e: new Error())
    guardedAt = st[2]
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
    unless server
      server = getModName(true)
    else
      server = new ModuleName(server, "", true)
    use: (client, srvr) ->
      unless client
        client = getModName(false)
      else
        client = new ModuleName(client, "", false)
      server = new ModuleName(srvr, "", false)  if srvr
      if (server.filename is client.filename) and (server.linenum is client.linenum)
        server.linenum = server.linenum + " (server)"
        client.linenum = client.linenum + " (client)"
      if enabled
        k.check x, server, client, [], stack
      else
        x
  "use strict"
  enabled = true
  unproxy = []
  unproxy = (->
    unproxy = undefined
    weak = undefined
    if typeof (WeakMap) isnt "undefined"
      weak = true
      unproxy = new WeakMap()
    else
      weak = false
      unproxy = []
    set: (p, c) ->
      if weak
        unproxy.set p, c
      else
        unproxy.push
          proxy: p
          contract: c

    get: (p) ->
      pc = undefined
      if weak
        if (p isnt null) and typeof p is "object" or typeof p is "function"
          unproxy.get p
        else
          `undefined`
      else
        pc = unproxy.filter((el) ->
          p is el.proxy
        )
        throw "assumption failed: unproxy object stores multiple unique proxies"  if pc.length > 1
        if pc.length is 1
          pc[0]
        else
          `undefined`
  )()
  Utils =
    getPropertyDescriptor: getPropertyDescriptor = (obj, prop) ->
      o = obj
      loop
        desc = Object.getOwnPropertyDescriptor(o, prop)
        return desc  if desc isnt `undefined`
        o = Object.getPrototypeOf(o)
        break unless o isnt null
      `undefined`

    merge: merge = (o1, o2) ->
      o3 = {}
      f = (o) ->
        for name of o
          o3[name] = o[name]  if o.hasOwnProperty(name)

      f o1
      f o2
      o3

    hasNoHoles: hasNoHoles = (obj) ->
      i = 0
      while i < obj.length
        return false  unless i of obj
        i++
      true

    zip: (a1, a2) ->
      i = undefined
      ret = []
      if not Array.isArray(a1) or not Array.isArray(a2) or (a1.length isnt a2.length)
        ret = []
      else
        i = 0
        while i < a1.length
          ret.push [ a1[i], a2[i] ]
          i++
      ret

  Contract:: =
    check: check = (val, pos, neg, parentKs, stack) ->
      c = unproxy.get(val)
      if c and c.equals(this)
        @handler val, pos, neg, parentKs, stack
        val
      else
        @handler val, pos, neg, parentKs, stack

    toContract: ->
      this

    toString: ->
      @cname

    equals: (other) ->
      throw "Equality checking must be overridden"

  ModuleName::toString = ->
    @filename + (if @linenum is "" then "" else (":" + @linenum))

  Function::toContract = ->
    name = "<user defined: " + @toString() + ">"
    check this, name

  any = (any = ->
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
  none = (none = ->
    c = new Contract("none", "none", (val, pos, neg, parentKs) ->
      blame pos, neg, this, val, parentKs
    )
    c.equals = (other) ->
      this is other

    c
  )()
  combinators =
    check: check
    fun: fun
    ctor: ctor
    ctorSafe: ctorSafe
    object: object
    arr: arr
    ___: ___
    any: any
    or: or_
    none: none
    not: not_
    and: and_
    opt: opt
    guard: guard

  contracts =
    Undefined: combinators.check((x) ->
      `undefined` is x
    , "Undefined")
    Null: combinators.check((x) ->
      null is x
    , "Null")
    Num: combinators.check((x) ->
      typeof (x) is "number"
    , "Num")
    Bool: combinators.check((x) ->
      typeof (x) is "boolean"
    , "Bool")
    Str: combinators.check((x) ->
      typeof (x) is "string"
    , "Str")
    Odd: combinators.check((x) ->
      (x % 2) is 1
    , "Odd")
    Even: combinators.check((x) ->
      (x % 2) isnt 1
    , "Even")
    Pos: combinators.check((x) ->
      x >= 0
    , "Pos")
    Nat: combinators.check((x) ->
      x > 0
    , "Nat")
    Neg: combinators.check((x) ->
      x < 0
    , "Neg")
    Arr: combinators.object(length: combinators.check((x) ->
      typeof (x) is "number"
    , "Number"))
    Self: self
    Any: any
    None: none

  combinators: combinators
  contracts: contracts
  enabled: (b) ->
    enabled = b
)()
