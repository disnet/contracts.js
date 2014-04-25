var c = window["contracts-js"];
module("Basic Contracts");

test("id of num", function() {
	@c { (Num) -> Num }
	function id(x) { return x; }


	same(id(100), 100);
});

test("two arguments", function() {
	@c { (Num, Str) -> Str }
	function id(x, y) { return y; }

	same(id(100, "foo"), "foo")
})

