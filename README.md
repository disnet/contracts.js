# Contracts.js

Contracts.js is a contract library for JavaScript that allows you to specify invariants between parts of your code and have them checked at runtime for violations. 

# Use

If you are loading in the browser directly or using AMD, include `lib/reflect.js` (contract.js depends on the ES6 reflect module which this [shims](https://github.com/tvcutsem/harmony-reflect)) and `contracts.js`. You'll need a harmony (ES6-ish) environment which means things only work for FF 4+, chrome with the harmony flag enabled, and node v0.7.8+ with `node --harmony`.

# Using macros

[Sweet.js](http://sweetjs.org) support is currently being added. The contract macros are defined in `macros/index.js` so to expand a file using contracts.js macros with sweet.js you can do `sjs -m macros/index.js my_file.js`. 

```js
// import the library 
var c = require("contacts-js");

// the `c` in `@c` needs to match the imported name
@c { (Num, Num) -> Num }
function add(x, y) { return x + y; } 

add(42, 24);         // 66
add(42, "a string"); // throws error

// higher order functions
@c { ((Num) -> Num, Num) -> Num}
function twice(f, x) { return f(f(x)) }

// still to implement:

// optional arguments
@c { (Num, Num, Str?) -> Num }
// call only
@c { (Num) --> Num }
// constructor only
@c { (Num) ==> Num }
// dependent functions
@c { (Num) -> !{
    function(result, args) { return result > args[0] } 
}}
function inc(x) { return x + 1; }
// !{ ... } means to escape from the contract language into JavaScript
// `this` contract
@c { (Num, @{name: Str}) -> Num }

// naming a contract
@c NumId { (Num) -> Num }
// naming a contact and escaping out of the contract language
@c Num {!{
    function(x) { return typeof x === "number" }
}}
// objects
// ...
// arrays
// ...
```

# Using the library directly

The basic idea is to use `guard` to wrap your value with contracts. For example:

```js
var c  = require("contracts-js");
var id = c.guard(c.fun(c.Num, c.Num),
                 function(x) { return x; });
id(42);     // 42
id("foo");  // contract violation!
```

# API

## `guard`


Guards a value with a contract.

	guard :: (Contract, Any, Str?, Str?) -> { use: () -> Any }
    guard(contract, value [, server[, client]])

  * _contract_ the contract to apply to the value
  * _value_ value to be wrapped in a contract
  * _server_ optional name of the server "module"
  * _client_ optional name of the client "module"



## `check`


Creates a contract that checks first-order values (i.e. not functions or objects).

	check :: ((Any) -> Bool, Str) -> Contract
	check(predicate, name)

  * _predicate_ function that takes a value and return true if the contract should pass or false otherwise
  * _name_ name of the contract. Displayed in contract violation messages.

This is used to build contracts that get applied to values via the `guard` function. The `guard` function handles calling the predicate supplied to `check` at the appropriate time.

An example of a contract to check for numbers:
	
	Contracts.check(function(x) { 
		return typeof(x) === 'number'; 
	}, 'Number')

## `fun`

	fun :: (Contract or [...Contract], 
			 	((Any) -> Contract) or Contract,
			 	{
			 		callOnly: Bool
			 		newOnly: Bool
			 		pre: (Any) -> Bool
			 		post: (Any) -> Bool
			 		this: {...}
			 	}) -> Contract
	fun(domain, range, options)

  * _domain_ Either a single contract or an array of contracts for each argument to the function
  * _range_ Either a single contract for the function's result or a function that returns a contract.
  * _options_ An options object:
	* _callOnly_ Signal a contract violation if `new` is used with the function
	* _newOnly_ Signal a contract violation if `new` is _not_ used with the function
	* _pre_ A predicate to run _before_ the function is run
	* _post_ A predicate to run _after_ the function is run
	* _this_ An object contract to guard the `this` object

Dependent function contracts (where the result depends on the argument values) are handled by using a function as the `range`. When the function returns its argument values are first passed to the `range` function which should return a contract. This contract is then used to check the original function's result.

As a contrived example:

	Contracts.fun(Str, function(x) { 
		if(x === 42) {
			return Contracts.Num;
		} else {
			return Contracts.Str;
		}
	})

If the function contracted is called with `42` then its result must be a `Num` otherwise it must be a `Str`.

Note that arguments are potentially mutable (they might be one value at the beginning of the function and different when the function returns) so keep that in mind when using dependent contracts.

## `object`


	object :: ({ ... }, 
				{ 
					extensible: Bool
					sealed: Bool
					frozen: Bool
					invariant: (Any) -> Bool
				}) -> Contract
	object(object, options)

  * _object_ An object with properties mapping to contracts that should be present in the contracted object
  * _options_ An objects object:
    * _extensible_ Object should be extensible
    * _sealed_ Object should be sealed
    * _frozen_ Object should be frozen
    * _invariant_ Predicate to run each time the contracted object changes

Object contracts are built with an object that maps properties to objects. Example:

	Contracts.object({
		foo: Str,
		bar: Num
	})

In this case the contracted object must have both the `foo` and `bar` properties (if missing, a contract violation is thrown at contract application time) and these properties must abide by their respective contracts (which are checked each time the property is changed).

Object invariants can be checked with the invariant option. Whenever any property is changed the invariant function is called with a reference to the object. If the invariant returns false a contract violation is thrown.
