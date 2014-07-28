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
sjs --module contracts.js -o output.js input.js
```

Then run your `output.js` file in any JavaScript environment. Some
features of contracts.js (eg. proxied objects and arrays) require ES6
features which not every JavaScript engine supports right now (any
recent version of Firefox is fine along with node.js/V8 with the
`--harmony` flag enabled).

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

### `Num`

A value that is `typeof` number.

### `Str`

A value that is `typeof` string.

### `Bool`

A value that is `typeof` boolean.

### `Odd`

A number that is odd (`val % 2 === 1`).

### `Even`

A number that is even (`val % 2 !== 1`).

### `Pos`

A positive number (`val >= 0`).

### `Nat`

A natural number (`val > 0`).

### `Neg`

A negative number (`val < 0`).

### `Any`

Any value.

### `None`

No value (not terribly useful).

### `Null`

The `null` value.

### `Undefined`

The `undefined` value.

### `Void`

Either `null` or `undefined`.

## Function Contracts

Function contracts take a comma delimited list of argument contracts
and a single return value contract:

```js
@ (Str, Num, Bool) -> Bool
function foo(s, n, b) { return b; }
```

### Optional Arguments

You can make an argument optional with the `opt` prefix:

```js
@ (Str, opt Bool) -> Str
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

The `opt` prefix makes a property optional:

```js
@ ({name: Str, age: opt Num}) -> Str
function get Name(o) { return o.name; }
```

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
