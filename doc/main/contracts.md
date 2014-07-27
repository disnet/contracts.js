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
npm install contracts.js
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
features of contracts.js (proxied objects and arrays) require ES6
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
