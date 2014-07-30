import @ from "contracts.js"

// note that the contract itself uses `f` wrong
// and thus will be blamed
@ (f: (Num) -> Num) -> res: Num | f("foo") > 10
function foo(f) { return f(24); }

foo(function(x) { return x; });
