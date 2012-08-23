[![build status](https://secure.travis-ci.org/disnet/contracts.js.png)](http://travis-ci.org/disnet/contracts.js)
Contracts.js
============

Contracts.js is a contract library for JavaScript that allows you to specify invariants between parts of your code and have them checked at runtime for violations. 

It is used in the CoffeeScript dialect [contracts.coffee](http://disnetdev.com/contracts.coffee/) but can also be used directly in normal JavaScript programs if you don't want to or can't use CoffeeScript.

This library is possible because of and requires [Proxies](https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Proxy) which is a new feature of JavaScript that is currently only implemented in Firefox 4+ and bleeding edge V8 (not yet in Chrome but they are in Node.js (0.5.8+) with the `--harmony_proxies` flag). 

Use
===

To use include these files:

  * src/stacktrace.js
  * src/contracts.js

This adds a `Contracts` object to the global scope that has two properties `Contracts.contracts` (which contains some prebuilt contracts to use) and `Contracts.combinators` (which contains utility functions to build new contracts).

We can now wrap a function in a contract like so:

    var C = Contracts.contracts,
    	K = Contracts.combinators,
    	id = K.guard(
              K.fun(C.Num, C.Num),
              function(x) { return x; });

    id = id.use();
    id("foo"); // contract violation!

If you would like to load all of the contracts and combinators into the global scope, just include `src/autoload.js`.

More documentation and rational can be found at the sister project [contracts.coffee](http://disnetdev.com/contracts.coffee/).

Contracts.combinators.guard
===========================

Guards a value with a contract

	Contracts.combinators.guard :: (Contract, Any, Str?, Str?) -> { use: () -> Any }
    Contracts.combinators.guard(contract, value [, server[, client]])

  * _contract_ the contract to apply to the value
  * _value_ value to be wrapped in a contract
  * _server_ optional name of the server "module"
  * _client_ optional name of the client "module"

Returns an object with a `.use` function that must be called before the contracted value can be used (this is done to correctly setup "module" names when they are not supplied to `guard`).

Contracts.combinators.check
===========================

Creates a contract that checks first-order values (i.e. not functions or objects).

	Contracts.combinators.check :: ((Any) -> Bool, Str) -> Contract
	Contracts.combinators.check(predicate, name)

  * _predicate_ function that takes a value and return true if the contract should pass or false otherwise
  * _name_ name of the contract. Displayed in contract violation messages.

This is used to build contracts that get applied to values via the `guard` function. The `guard` function handles calling the predicate supplied to `check` at the appropriate time.

An example of a contract to check for numbers:
	
	Contracts.combinators.check(function(x) { 
		return typeof(x) === 'number'; 
	}, 'Number')

Contracts.combinators.fun
=========================

	Contracts.combinators.fun :: (Contract or [...Contract], 
								 	((Any) -> Contract) or Contract,
								 	{
								 		callOnly: Bool
								 		newOnly: Bool
								 		pre: (Any) -> Bool
								 		post: (Any) -> Bool
								 		this: {...}
								 	}) -> Contract
	Contracts.combinators.fun(domain, range, options)

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

	Contracts.combinators.fun(Str, function(x) { 
		if(x === 42) {
			return Contracts.contracts.Num;
		} else {
			return Contracts.contracts.Str;
		}
	})

If the function contracted is called with `42` then its result must be a `Num` otherwise it must be a `Str`.

Note that arguments are potentially mutable (they might be one value at the beginning of the function and different when the function returns) so keep that in mind when using dependent contracts.

Contracts.combinators.object
============================


	Contracts.combinators.object :: ({ ... }, 
										{ 
											extensible: Bool
											sealed: Bool
											frozen: Bool
											invariant: (Any) -> Bool
										}) -> Contract
	Contracts.combinators.object(object, options)

  * _object_ An object with properties mapping to contracts that should be present in the contracted object
  * _options_ An objects object:
    * _extensible_ Object should be extensible
    * _sealed_ Object should be sealed
    * _frozen_ Object should be frozen
    * _invariant_ Predicate to run each time the contracted object changes

Object contracts are built with an object that maps properties to objects. Example:

	Contracts.combinators.object({
		foo: Str,
		bar: Num
	})

In this case the contracted object must have both the `foo` and `bar` properties (if missing, a contract violation is thrown at contract application time) and these properties must abide by their respective contracts (which are checked each time the property is changed).

Object invariants can be checked with the invariant option. Whenever any property is changed the invariant function is called with a reference to the object. If the invariant returns false a contract violation is thrown.
