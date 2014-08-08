% Contracts.js Documentation
%

# Introduction

Contracts.js is a contract library for JavaScript that allows you to
specify invariants between parts of your code and have them checked at
runtime for violations.

# Installation

Requires [sweet.js](http://sweetjs.org) which you can install via npm:

```
npm install -g sweet.js
npm install contracts-js
```

# Using

At the top of your file you will need to use some special syntax to
import contracts.js:

```js
import @ from "contracts.js"

// rest of your code goes here...
```

This looks like ES6 modules but it's not really and will work with
whatever module system you are using (if any). See
[here](#what-is-up-with-the-import) for details.

Compile your JavaScript file with sweet.js using the contracts.js module:

```
sjs --module contracts-js/macros -o output.js input.js
```

Then run your `output.js` file in any JavaScript environment. Some
features of contracts.js (eg. proxied objects and arrays) require ES6
features which not every JavaScript engine supports right now (any
recent version of Firefox is fine along with node.js/V8 with the
`--harmony` flag enabled).

If you want to disable contract checking (eg. for a production build)
you can use the disabled contracts module:

```
sjs --module contracts-js/macros/disabled.js -o output.js input.js
```



# Contracts

Put a contract on a function like this:

```js
@ (Num) -> Num
function id(x) {
    return x;
}
```

Then when the function's contract is violated you'll get a really nice
error message:

```js
id("a string");
/*
Error: id: contract violation
expected: Num
given: 'a string'
in: the 1st argument of
    (Num) -> Num
blaming: (calling context for id)
*/
```

## Basic Contracts

Contracts.js comes with a number of basic contracts that check for
first-order properties (things like `typeof` checks).

| Contract    | Description                            |
|-------------+----------------------------------------|
| `Num`       | A value that is `typeof` number        |
| `Str`       | A value that is `typeof` string        |
| `Bool`      | A value that is `typeof` boolean       |
| `Odd`       | A value that is odd (`val % 2 === 1`)  |
| `Even`      | A value that is even (`val % 1 === 0`) |
| `Pos`       | A positive number(`val >= 0`)          |
| `Nat`       | A natural number (`val > 0`)           |
| `Neg`       | A negative number (`val < 0`)          |
| `Any`       | Any value                              |
| `None`      | No value (not terribly useful)         |
| `Null`      | The `null` value                       |
| `Undefined` | The `undefined` value                  |
| `Void`      | Either `null` or `undefined`           |


### Custom Predicate Contracts

All of the basic contracts are built with predicates (functions that
take a single value and return a boolean) and you can make your own:

```js
function MyNum(val) {
    return typeof val === "number";
}
@ (MyNum) -> MyNum
function id(x) { return x; }
```

There is also ES6 arrow function shorthand syntax for defining
predicate contracts inside of a function or object contract:

```js
@ ((val) => typeof val === "function") -> Num
function id(x) { return x; }
```

## Function Contracts

Function contracts take a comma delimited list of argument contracts
and a single return value contract:

```js
@ (Str, Num, Bool) -> Bool
function foo(s, n, b) { return b; }
```

### Optional Arguments

You can make an argument optional with the `?` prefix:

```js
@ (Str, ?Bool) -> Str
function foo(s, b) { return s; }

foo("foo");        // fine
foo("foo", false); // fine
foo("foo", "bar"); // error
```

### Higher-Order Arguments

You can put contracts on functions to functions. And blaming the
correct party at fault even works!
[Mostly](what-about-blaming-modules).

```js
@ (Num, (Num, Num) -> Num) -> Num
function (x, f) { return f(x, x); }
```

### Contracts on `this`

You can put a contract on the `this` object of a function:

```js
@ () -> Str
| this: {name: Str}
function f() { return this.name; }

var o = {
    nam: "Bob", // typo
    f: f
};
o.f();
```

This will let you know you did something wrong:

<pre style="color: red">
f: contract violation
expected: Str
given: undefined
in: the name property of
    the this value of
    () -> Str
    | this: {name: Str}
function f guarded at line: 3
blaming: (calling context for f)
</pre>

### Dependent Contracts

You can also write a function contract who's result depends on the
value of its arguments.

```js
@ (x: Pos) -> res: Num | res <= x
function square_root(x) { return Math.sqrt(x); }
```

Name each argument and result with the notation `<name>: <contract>`
and then each name can be referred to in the dependency guard
following the `|`. The guard is an expression the must evaluate to a
boolean. If the guard evaluates to `true` the dependent function
contract will pass otherwise it fails.

If you need more than a single boolean expression you can wrap it in
curlies:

```js
@ (x: Pos) -> res: Num | {
    var fromlib = Math.sqrt(x);
    return res <= x && fromlib === res;
}
function square_root(x) { return Math.sqrt(x); }
```

Note that guards in a dependent contract could potentially violate
a contract on one of the arguments:

```js
@ (f: (Num) -> Num) -> res: Num | f("foo") > 10
function foo(f) { return f(24) }
```

In a case like this, the contract itself will be blamed:

<pre style="color:red">
expected: Num
given: 'foo'
in: the 1st argument of
    the 1st argument of
    (f: (Num) -> Num) -> res: Num | f (foo) > 10
function foo guarded at line: 2
blaming: the contract of foo
</pre>

If you are familiar with contract research, this is the [indy](http://www.ccs.neu.edu/racket/pubs/popl11-dfff.pdf) semantics.




## Object Contracts

Object contracts are built using familiar object literal syntax:

```js
@ (Str, Num) -> {name: Str, age: Num}
function makePerson(name, age) {
    return {
        name: name,
        age: age
    };
}
```

Note that objects are checked against their contract only once when
they cross the contract barrier (in the above example this is when the
`makePerson` function returns). Basic contracts (like `Str` and `Num`)
are checked immediately while method contracts are deferred until
the method is invoked.

If you want to maintain the contract invariants throughout the
object's lifetime, use [proxied object contracts](#proxied-objects).

### Optional Properties

The `?` prefix makes a property optional:

```js
@ ({name: Str, age: ?Num}) -> Str
function get Name(o) { return o.name; }
```

### Method Contracts

Function contracts on an object contract will implicitly check that
the `this` object bound to the function obeys the object contract:

```js
@ ({name: Str, hi: () -> Str}) -> Str
function foo(o) {
  var hi = o.hi;
  return hi();  // `this` is bound wrong
}

foo({
  name: "Bob",
  hi: function() {
    return this.name;
  }
})
```

This code will give a nice error letting us know that the `this`
object was wrong:

<pre style="color: red">
foo: contract violation
expected: an object with at least 2 keys
given: undefined
in: the this value of
    the hi property of
    the 1st argument of
    ({name: Str, hi: () -> Str}) -> Str
function foo guarded at line: 2
blaming: function foo
</pre>

### Proxied Objects

To maintain the object contract invariant for the entire lifetime of
an object, use the `!` notation:

```js
@ (Str, Num) -> !{name: Str, age: Num}
function makePerson(name, age) {
    return {
        name: name,
        age: age
    };
}

var o = makePerson("Bob", 42);
o.age = "100";  // error
```

This is more expensive than normal object contracts since the contract
must be checked on every property set but this can help to maintain
tricky invariants.




## Array Contracts

Contracts on arrays use the familiar array literal notation:

```js
@ ([Num, Str]) -> Void
function foo(arr) { /* ... */ }

foo([42, "foo"]);  // fine
foo([42]);         // error missing field
```

### Repeated Fields

Arrays filled with homogeneous data can use the `...` notation:

```js
@ ([...Num]) -> Void
function foo(arr) { /* ... */ }

foo([]);                      // fine
foo([42, 100, 10000, 99]);    // fine
foo([42, "foo", 10000, 99]);  // error wrong type
```

You can even mix `...` with a prefix of normal contracts:

```js
@ ([Str, Bool, ...Num]) -> Void
function foo(arr) { /* ... */ }

foo(["foo", true, 100, 99]);  // fine
foo([100, true, 100, 99]);    // error wrong type
```

The `...` contract must be the last contract in the array.


### Proxied Arrays

Just like objects, arrays can be proxied with the `!` notation:

```js
@ (Num, Str) -> ![Num, Str]
function foo(a, b) { return [a, b]; }

var arr = foo(100, "foo");

arr[0] = "string";          // error wrong type
```

## Combinators

### `or`

You can combine two contracts with the `or` combinator. If the first
contract fails, the combined contract will succeed if the second
passes.

```js
@ (Num or Str) -> Str
function foo(x) { return x.toString(); }

foo(24);    // passes
foo("24");  // passes
foo(false); // error not a Num or Str
```

Note that `or` only makes sense for at most one higher-order contract.
For example, `Num or (Num) -> Num` is fine but `(Num) -> Num or
(Str) -> Str` will not work.


## Naming Contracts

When you have a complicated contract that is repeated in several
places it can be convenient to refer to it by a shorter name. For
this, you can use `let` after the `@` symbol:

```js
@ let NumId = (Num) -> Num


@ (NumId, Num) -> Num
function (f, x) { return f(x); }
```

## Recursive Contracts

You can define contracts that have a recursive definition naturally:

```js
@ let MyObj = Null or {
    a: Num,
    b: MyObj
}
```

This definition checks that the `b` property is either a `null` or an
object that satisfies the `{a: Num, b: MyObj}` contract. Note that
this will explore the entire object each time a value crosses the
contract boundary so it could be potentially expensive if the object
is deeply nested.

## Parametric Polymorphism

Note: requires proxies (so use Firefox out of the box or
Chrome/V8/node with the `--harmony` flag).

Parametric polymorphic functions can be defined using `forall`:

```js
@ forall <name (,) ...> <contract>
```

Where each `name` is a contract variable to be bound in `contract`.
For example, the identity function is defined as:

```js
@ forall a (a) -> a
function id(x) { return x; }
```

The contract enforces the invariant that for all types, the value
applied to `id` will be returned from the function. If the function
does not obey this invariant a contract violation will be triggered:

```js
@ forall a (a) -> a
function const5(x) { return 5; }

const5(10);
```

will throw the error:

<pre style="color:red">
const5: contract violation
expected: an opaque value
given: 5
in: in the type variable a of
    the return of
    (a) -> a
function const5 guarded at line: 2
blaming: function const5
</pre>

A key idea of parametric polymorphism is that a function cannot
inspect the value of a polymorphic type (otherwise it doesn't really
work "forall"). For example, the `inc_if_odd` function behaves like
the identity function unless its argument is odd, which violates the
parametric invariant:

```js
@ forall a (a) -> a
function inc_if_odd(x) {
    if (x % 2 !== 0) {
        return x + 1;
    }
    return x;
}
```

So, attempting to invoke `inc_if_odd(100)` will throw the error:

<pre style="color:red">
inc_if_odd: contract violation
expected: value to not be manipulated
given: 'attempted to inspect the value'
in: in the type variable a of
    the 1st argument of
    (a) -> a
function inc_if_odd guarded at line: 2
blaming: function inc_if_odd
</pre>

Note that there are a couple of operations on values that contracts.js
cannot currently guard against (`typeof` in particular).

Polymorphic contracts also do contract inference. So, if you have a
polymorphic array, contracts.js will check that the array is homogeneous:

```js
@ forall a ([...a]) -> [...a]
function arrayId(l) {
    return l;
}
arrayId([1, 2, "three"]);
```

This infers that the `a` should be a `Num` for this application of
`arrayId` and then throws and error when it discovers `"three"`:

<pre style="color:red">
arrayId: contract violation
expected: (x) => typeof x === 'number'
given: 'three'
in: in the type variable a of
    the 2nd field of
    the 1st argument of
    ([....a]) -> [....a]
function foo guarded at line: 2
blaming: (calling context for arrayId)
</pre>

Contract inference is currently done with simple `typeof` checks.

# FAQ

## Do I have to use macros?

No, as a matter of fact. If you'd like to just use the library in
vanilla JavaScript you can. Load contracts.js and then use the `guard`
function:

```js
var id = guard(fun([Num], Num),
               function id(x) { return x; },
               "id");
```

## What is up with the import?

```js
import @ from "contracts.js"
```

The short answer is that it's a hack until sweet.js provides proper
module support.

This line is actually a macro that expands into contracts.js library
code that each contracted function will refer to.


## What about blaming modules?

At the moment contracts.js just supports guarding the interaction of a
contracted value and its context rather than tracking blame at the
module level. This is because the module story in JavaScript is a bit
fractured and incompatible in various ways (CommonJS, Node, AMD, ES6,
rolling by hand). Earlier versions of contracts.js had hacky support
that only kind of worked but this has been temporarily simplified to
what we have right now.

Once sweet.js has good ES6 module support we will do the right thing
and track blame at the module level.


## How can I disable contracts in production?

Compile with the `disabled.js` module:

```
sjs --module contracts-js/macros/disabled.js -o output.js input.js
```
