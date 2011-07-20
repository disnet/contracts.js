// **Contracts.js** is a JavaScript library that allows you to
// express and enforce complex run-time
// assertions on JavaScript code. You can write contracts for
// just about anything in JavaScript including functions (both
// first-order, higher-order, and dependent), objects, and arrays.

// To get an idea of how it works, consider this increment function
// which simply adds `1` to its argument.
var inc = function(x) { return x + 1; };
// Calling `inc` with `4` returns `5` as you would expect but since this is JavaScript
// if we call inc with something it wasn't expecting odd things can happen.
inc(4);        // ==> 5

// For example if we call it with a string  type coercion gives
// us `"hello1"` which we probably weren't expecting.
// The problem here
// is that `inc` expects to always be called with a number but doesn't
// actually check its argument.
inc("hello");  // ==> "hello1"

// So let's see how contracts can help us. 

// The contracts library provides three important functions here:
// `guard`, `fun`, and `Num`. The `guard` function takes a **contract**
// and a value and returns the value guarded by the contract. The
// `fun` function is a contract **combinator** that takes two contracts
// and returns a new contract that checks function calls. The `Num` contract
// simply checks that a value is a JavaScript `Number`.
//
// So this call to `guard` will return a function that checks
// that it is always called with a `Num` and always returns
// a `Num`.
inc = guard(
    fun(Num, Num),                   // a function contract
    function(x) { return x + 1; });  // the function to guard

// When we call the guarded function with a number
// everything works just like normal.
inc(4);      // ==> 5

// But when we call it with a string, the contract fails and
// we get a nice error message informing us of our mistake:
// <pre><code style="color: red">Error: Contract violation: expected &lt;Number&gt;, actual: "hello"
// Blame is on client of value guarded at: @/path/to/file.js:27
// Parent contracts:
// Number -> Number 
// </code></pre>
// This lets us know which contract failed (`Number`), what the value
// was that caused the contract to fail (`"hello"`), who was at fault
// (either the function being guarded or as in this case the
// client of the function), where the function was originally
// guarded (`file.js:27`), and a list of parent contracts
// (the function contract `(Number) -> Number`).
inc("hello"); // fails contract!

// We can also apply contracts to higher-order functions.
var hoFun = guard(
    fun(fun(Num, Bool), Num),
    function(f) {
        if( f(42) ) {
            return 42;
        } else {
            return -1;
        }
    });
// If the client client passes a function that doesn't pass its
// contract, we will fail pointing blame on the client of `hoFun`.
// <pre><code style="color: red">Error: Contract violation: expected &lt;Boolean&gt;, actual: "foo"
// Blame is on client of value guarded at: @/path/to/file.js:42
// Parent contracts:
// Number -> Boolean 
// (Number -> Boolean) -> Number 
// </code></pre>
hoFun(function(n) { return "foo"; });

// There is also a combinator for objects.
guard(
    object({ a: Str, b: Num}),
    { a: "foo", b: 42 });

// Along with arrays.
// 
// Here the first two elements of
// the array must be a `Str` and a `Num` while the rest must be `Boolean`.
guard(
    arr([Str, Num, ___(Bool)]),
    ["foo", 42, false, true, true, false, true]);

// You can also write your own flat contracts using
// the `check` combinator which takes a function that
// checks its argument and returns true if the contract passed
// and false if it failed.
var Even = check(function(val) {
    return (val % 2) === 0;
}, "Even");

// The `Num`, `Str`, and `Bool` contracts are implemented via
// `check` by simply doing a `typeof` test.
var Num = check(function(val) {
    return typeof(val) === "number";
}, "Number");


// You can also express dependent function contracts (where the result of
// calling a function depends on its arguments).
guard(
    fun(Num, function(argument) {
        return check(function(result) {
            return result > argument;
        });
    }),
    function(n) { return n + 1; });
