// guard :: Contract x any x String x String

// functions: simple
return guard(
     fun(Str, Bool),
     function(s) { return false; },
     server, client)

// multiple args
return guard(
     fun([Str, Bool], Bool),
     function(s, b) { return false; },
     server, client)

// optional args 
return guard(
     fun([Str, Opt(Bool), Opt(Str)], Bool),
     function(s, b) { /* ... */ },
     server, client)

// optional args, bad form
return guard(
     fun([Str, Opt(Bool), Opt(Str), Num], Bool), // fail, can't have non-optional after optional
     function(s, b) { /* ... */ },
     server, client)

// optional args, if one optional is provided all required
return guard(
     fun([Str, Opt([Bool, Str])], Bool), 
     function(s, b) { /* ... */ },
     server, client)

// higher-order
return guard(
     fun(fun(Str, Bool), Str),
     function(f, b) { /* ... */ },
     server, client)

// dependent
return guard(
     fun(Str, function(arg) { return check(function(r) { return arg === r; }); }),
     function(x) { return x; },
     server, client)

// constructor only
return guard(
     ctor(Str, object({a: Str, b: Num})),
     function(s) { this.a = s; this.b = 42; },
     server, client)
// desugars to 
return guard(
     functionContract(Str, object({a: Str, b: Num}),
                     { newOnly: true }),
     function(s) { this.a = s; this.b = 42; },
     server, client)

// call only
return guard(
     funCall(Str, Bool), // funNN? funNoNew? funCO? default behavior for fun? no convenience form?
     function(s) { /* ... */ },
     server, client)
// so .newOnly(true).callOnly(true) -> throw exception
// desugars to
return guard(
     functionContract(Str, Bool, { callOnly: true }),
     function(s) { /* ... */ },
     server, client)

// lazy new constructor
return guard(
     ctorSafe(Str, object({a: Str, b: Num})),
     function(s) { this.a = s; this.b = 42; },
     server, client)
// will automatically create the right new:
// new f(..) works normally
// f(..) will create the appropriate "this" and apply it to f
// desugars to
return guard(
     functionContract(Str, object({a: Str, b: Num}), { safeNew: true }),
     function(s) { this.a = s; this.b = 42; },
     server, client)

// different contract for call and new
return guard(
     ctor({
         call: fun(Str, Bool),
         new : fun(Str, object({a: Str, b: Num}))
     }),
     function(s) { /* ... */ },
     server, client)

// explicit contract on this
return guard(
     fun(Str, Bool,
         { this: object({ a: Str, b: Num })}
        ),
     function(s) { return this.a + this.b; },
     server, client)
// lazy vs strict checking of object properties?
// what about .onlyNew(true).thisContract({a: Str})? throw exception?


// objects: data obj
return guard(
     object({
          a: Str,
          b: Bool
     }),
     {a: "foo", b: false},
     server, client);

// nested data objects
// eager vs lazy checking?
return guard(
     object({
          a: Str,
          b: object({
               c: Bool,
               d: Num
          })
     }),
     {a: "foo", b: {c: false, d: 42}},
     server, client)

// immutable 
return guard(
     object({
          a: Str,
          b: Num
     }, { immutable: true }), // todo: figure out correct ES5 term
     {a: "foo", b: 42},
     server, client)     

// immutable properties
return guard(
     object({
          a: [Str, {immutable: true}],
          b: Num
     }), // todo: figure out correct ES5 term
     {a: "foo", b: 42},
     server, client)     

// recursive
var o = { a : "hi", b: null}
o.b = o;
// or
var o = rec(function(o) { return { a : "hi", b: o}; });
return guard(
     object({
          a: Str,
          b: self 
     }),
     o,
     server, client)

// object with simple method
return guard(
     object({
          a: Str,
          m: fun(Str, Bool)
     }),
     {a: "foo", m: function(s) { /* ... */ }},
     server, client)
// implicit this contract? "desugars" to:
return guard(
     object({
          a: Str,
          m: fun(Str, Bool, {
              this : object({a: Str, m: fun(Str, Bool).thisContract(...)})
          })
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
          a: Str,
          m: fun(Str, Bool, { this: object({c: Bool, d: Str})})
     }),
     {a: "foo", m: function(s) { return this.c + this.d; }},
     server, client)
// overrides the implicit this contract on methods


// object with method that has pre/post conditions
return guard(
     object({
          a: Str,
          m: fun(Str, Bool, {
              pre: function(obj) { return obj.a === "foo"; }, // obj is a ref to the calling object (could be this?)
              post: function(obj) { return obj.a === "foo"; }
          })
     }),
     {a: "foo", m: function(s) { /* ... */ }},
     server, client)

// prototype
var p = guard(
     object({
          a: Str,
          b: Num
     }),
     {a: "foo", b: 42},
     server, client)
var op = Object.create(p, {c: false, d: function() {}})
return guard(
     object({
          c: Bool,
          d: fun(Str, Bool)
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
          d: fun(Str, Bool)
     }, {
         proto: object({     // this would be anywhere on the prototype chain (aka anything not ownProperty)
          a: Str,
          b: Num
         })}
     ),
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
     object({}, {
         immutable: true,
         noDelete: true,
         init: [Array.isArray, hasNoHoles]
     }),
     [1,2,3],
     server, client)

// SaneArray
return guard(
     SaneArray,
     [1,2,3],
     server, client)
// desugars to
return guard(
     object({}, {
          immutable : false,
          noDelete: true, // does this make sense? maybe only noDelete for indexes?
          init : [Array.isArray, hasNoHoles]
     }),
     [1,2,3],
     server, client)

// array
return guard(
     Array,
     [1,2,3],
     server, client)
// desugars to
return guard(
     object({}, {
          immutable : false,
          noDelete : false,
          init : [Array.isArray]
     }),
     [1,2,3],
     server, client)

// arr is the structural version of array checking
return guard(
    arr([Str, Bool]), // or arr(Str, Bool)?
    ["foo", false],
    server, client
);

return guard(
    arr([___(Num)]),
    [1,2,3,4,5],
    server, client
);

return guard(
    arr([Str, ___(Num)]),
    ["foo", 1,2,3,4],
    server, client
);

return guard(
    arr([Str, ___(Num), Bool]),
    ["foo", 1,2,3,4, false],
    server, client
);

return guard(
    arr([_, ___(Num)]), // single underscore aliased to Any?
    [false, 1,2,3],
    server, client
);

