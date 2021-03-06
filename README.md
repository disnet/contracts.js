# Contracts.js

Contracts.js is a contract library for JavaScript that allows you to
specify invariants between parts of your code and have them checked at
runtime for violations. It's heavily inspired by the contract system
found in [Racket](http://docs.racket-lang.org/guide/contracts.html) and
tracks blame correctly for higher-order values.

For example, you can specify the that following function takes two
arguments, one that is an object with a string `name` field and the
other that is an array filled with objects that have a `loc` number
field, and returns a string.

```js
import @ from "contracts.js"

@ ({name: Str}, [...{loc: Num}]) -> Str
function calcAverageLoc(person, locArr) {
    var sum = locArr.reduce(function (l1, l2) {
        return l1.loc + l2.loc;
    });
    return "Average lines of code for " +
           person.name + " was " +
           sum / locArr.length;
}

```

If you call the function with a bad argument:

```js
var typoPerson = {nam: "Bob"};
calcAverageLoc(typoPerson, [{loc: 1000}, {loc: 789}, {loc: 9001}]);
```

you will get a helpful error message pin pointing what went wrong:

<pre style="color:red">
calcAverageLoc: contract violation
expected: Str
given: undefined
in: the name property of
    the 1st argument of
    ({name: Str}, [....{loc: Num}]) -> Str
function calcAverageLoc guarded at line: 4
blaming: (calling context for calcAverageLoc)
</pre>

You can play around with this and other examples on the
[homepage](http://disnetdev.com/contracts.js).

# Installation

Uses [sweet.js](http://sweetjs.org) which you can install via npm:

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
[here](http://www.contractsjs.org/doc/main/contracts.html#what-is-up-with-the-import) for details.

Compile your JavaScript file with sweet.js using the contracts.js module:

```
sjs --module contracts-js/macros -o output.js input.js
```

Then run your `output.js` file in any JavaScript environment. Some
features of contracts.js (eg. proxied objects and arrays) require ES6
features which not every JavaScript engine supports right now (any
recent version of Firefox is fine along with node.js/V8 with the
`--harmony` flag enabled).

# Documentation

Contracts.js is documented [here](http://www.contractsjs.org/).


# Related Work

An initial stab at adding good contract syntax via macros to
JavaScript was done in
[sweet-contracts](https://github.com/oleiman/sweet-contracts).

[rho-contracts](https://github.com/sefaira/rho-contracts.js) is a
contract library for vanilla JavaScript in the same style as
contracts.js (in the sense that both project trace their design
inspiration to the higher-order contracts in Racket). While
contracts.js can work in vanilla JS (using the `guard` wrapper
function), rho-contracts probably has better ergonomics when used as a
library with no special syntax support.

[TreatJS](http://proglang.informatik.uni-freiburg.de/treatjs/) is
another contract library for JavaScript.
