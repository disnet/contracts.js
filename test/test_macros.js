var c = window["contracts-js"];
module("Basic Contracts");

test("id of num", function() {
	@c { (Num) -> Num }
	function id(x) { return x; }


	same(id(100), 100);
	raises(function() {
		id("foo")
	}, "wrong types");
});

test("two arguments", function() {
	@c { (Num, Str) -> Str }
	function id(x, y) { return y; }

	same(id(100, "foo"), "foo")
	raises(function() {
		id("foo", 100)
	}, "wrong types");
});

test("functions as arguments", function() {
	@c { ((Num) -> Num, Num) -> Num }
	function twice(f, x) { return f(f(x)) }

	function inc(x) { return x + 1; }
	same(twice(inc, 10), 12);

	raises(function() {
		twice(inc, "foo");
	}, "called with wrong second argument")

	raises(function() {
		function badinc(x) { return "string" }
		twice(badinc, 12);
	}, "supplied function was wrong")
});

test("functions as return", function() {
	@c { (Num) -> (Num) -> Num }
	function makeAddr(x) {
		return function(y) { return x + y }
	}	

	var add = makeAddr(10);
	same(add(5), 15);
});
