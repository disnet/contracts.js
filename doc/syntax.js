// guard :: Contract x any x String x String

// functions: simple
return guard(
     fun(String, Bool),
     function(s) { return false; },
     server, client)

// multiple args
return guard(
     fun(String, Bool, Bool),
     function(s, b) { return false; },
     server, client)

// optional args (unclear about this one)
// for the optional arguments, if they are present they must satisfy their contract
// what do we do with multiple optional args?
// is a "Optional" combinator the best way to go?
return guard(
     fun(String, Optional(Bool), Optional(String), Bool)
     function(s, b) { /* ... */ },
     server, client)

// higher-order
return guard(
     fun(fun(String, Bool), String),
     function(f, b) { /* ... */ },
     server, client)

// dependent
return guard(
     fun(String, function(arg) { return flat(function(r) { return arg === r; }); }),
     function(x) { return x; },
     server, client)

// constructor only
return guard(
     fun(String, object({a: String, b: Number}))
          .newOnly(true),
     function(s) { this.a = s; this.b = 42; },
     server, client)

// call only
return guard(
     fun(String, Bool)
          .callOnly(true),
     function(s) { /* ... */ },
     server, client)
// so .newOnly(true).callOnly(true) -> throw exception

// lazy new constructor
return guard(
     fun(String, object({a: String, b: Number}))
          .lazyNew(true),
     function(s) { this.a = s; this.b = 42; },
     server, client)
// will automatically create the right new:
// new f(..) works normally
// f(..) will create the appropriate "this" and apply it to f
// better name than lazyNew? lazy implies delayed...sort of true

// different contract for call and new
return guard(
     fun(String, Bool)
          .newContract(String, object({a: String, b: Number})), // or to be isomorphic: .newContract(fun(String, obj...))
     function(s) { /* ... */ },
     server, client)
// name issue...newContract makes me think it is a new (not old) contract not a contract for the new form...

// explicit contract on this
return guard(
     fun(String, Bool)
          .thisContract({ a: String, b: Number }), // or to be isomorphic: .thisContract(object{ a: Num...})
     function(s) { return this.a + this.b; },
     server, client)
// lazy vs strict checking of object properties?
// what about .onlyNew(true).thisContract({a: String})? throw exception?


// objects: data obj
return guard(
     object({
          a: String,
          b: Bool
     }),
     {a: "foo", b: false},
     server, client);

// nested data objects
// eager vs lazy checking?
return guard(
     object({
          a: String,
          b: object({
               c: Bool,
               d: Number
          }
     },
     {a: "foo", b: {c: false, d: 42}},
     server, client)

// immutable 
// subsumed by freeze?
return guard(
     object({
          a: String,
          b: Number
     }).immutable(true) // default false
     {a: "foo", b: 42},
     server, client)     

// recursive
var o = { a : "hi", b: null}
o.b = o;
return guard(
     object({
          a: String,
          b: self // right name? that? thiss? thisz?
     }),
     o,
     server, client)

// object with simple method
return guard(
     object({
          a: String,
          m: fun(String, Bool)
     }),
     {a: "foo", m: function(s) { /* ... */ }},
     server, client)
// implicit this contract? "desugars" to:
return guard(
     object({
          a: String,
          m: fun(String, Bool)
               .thisContract({a: String, m: fun(String, Bool).thisContract(...)})
     }),
     {a: "foo", m: function(s) { /* ... */ }},
     server, client)
// if object contract checking of this is eager then we could have 
// a problem...module pattern where methods are really functions that don't refer to this
// should be fine with lazy checking though? if function never uses this, checking never happens.
// what if we had a function that used this in a generic way? wouldn't want any contract so be explicit about
// there not being a contract? .thisContract({})
// a little non-obvious but this seems like a rare pattern so probably fine?

// object with simple method explicit about this contract
return guard(
     object({
          a: String,
          m: fun(String, Bool)
               .thisContract({c: Bool, d: String})
     }),
     {a: "foo", m: function(s) { return this.c + this.d; }},
     server, client)
// overrides the implicit this contract on methods


// object with method that has pre/post conditions
return guard(
     object({
          a: String,
          m: fun(String, Bool)
               .pre(function(obj) { return obj.a === "foo"; }) // obj is a ref to the calling object (could be this?)
               .post(function(obj) { return obj.a === "foo"; })
     }),
     {a: "foo", m: function(s) { /* ... */ }},
     server, client)

// prototype
var p = guard(
     object({
          a: String,
          b: Number
     }),
     {a: "foo", b: 42},
     server, client)
var op = Object.create(p, {c: false, d: function() {}})
return guard(
     object({
          c: Bool,
          d: fun(String, Bool)
     }),
     op,
     server, client)
// anything weird going on here? blame goes to proto if failing proto contract.
// blame falls on op if fails op contract. all should be fine right?          

// maybe we want ability to distinguish between object and proxy in one swoop?
var op = Object.create({a: "foo", b: 42}, {c: false, d: function() {}})
return guard(
     object({
          c: Bool,
          d: fun(String, Bool)
     }).proto({     // this would be anywhere on the prototype chain (aka anything not ownProperty)
          a: String,
          b: Number
     }),
     op,
     server, client)
// does this really give us anything over the previous form?

// List
return guard(
     List,
     [1,2,3],
     server, client)
// desugars to
return guard(
     object({})
          .immutable(true)
          .noDelete(true)     // blame if delete is called on property
          .init(Array.isArray, hasNoHoles), // init calls predicates when wrapping object
     [1,2,3],
     server, client)

// SaneArray
return guard(
     SaneArray,
     [1,2,3],
     server, client)
// desugars to
return guard(
     object({})
          .immutable(false)
          .noDelete(true) // does this make sense? maybe only noDelete for indexes?
          .init(Array.isArray, hasNoHoles),
     [1,2,3],
     server, client)

// array
return guard(
     Array,
     [1,2,3],
     server, client)
// desugars to
return guard(
     object({})
          .immutable(false)
          .noDelete(false)
          .init(Array.isArray),
     [1,2,3],
     server, client)
