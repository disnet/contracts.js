var c = window["contracts-js"];
module("Basic Contracts");

test("checking id", function() {
	@c { (Num) -> Num }
	function id(x) { return x; }

	@c { (Num, Str) -> Num }
	function id(x) { return x; }
	// @c (Num) -> Num
	// id = (x) => x

	same(id(100), 100);
});

