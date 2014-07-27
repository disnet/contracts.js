var expect = require("expect.js");
import @ from "contracts.js";



describe("contracts", function() {
    it("should blame the context when called wrong", function() {
        @ (Num) -> Num
        function numId(x) { return x; }

        expect(numId(42)).to.be(42);
        numId('foo');
    });

    it("should blame function when it goes wrong", function() {
        @ (Num) -> Num
        function numId(x) { return "foo"; }

        numId(42);
    });

    it("should blame the correct argument in a multiple argument function", function() {
        @ (Num, Str) -> Num
        function f(x, y) { return x; }

        f(42, 42);
    });

    it("should not blame when optional arguments are omitted", function() {
        @ (Num, opt Str) -> Num
        function f(x, s) {
            return x;
        }

        f(100);
    });

    it("should blame when optional arguments are wrong", function() {
        @ (Num, opt Str) -> Num
        function f(x, s) {
            return x;
        }

        f(100, 100);
    });

    it("should blame when not given a function for a function contract", function() {
        @((Num) -> Num) -> Num
        function f(g) { return g(42); }

        f(42);
    });

    it("should correctly blame context in the higher-order case", function() {
        @ ((Num) -> Num) -> Num
        function numApp(f) {
            return f(42);
        }

        numApp(function(x) {
            return "string";
        });

    });

    it("should correctly blame the function in the higher-order case", function() {
        @ ((Num) -> Num) -> Num
        function bad(f) {
            return f("string");
        }

        bad(function(x) { return x; });
    });

    it("should blame the context for object contracts", function() {
        @ ({age: Num}) -> Num
        function f(o) { return o.age; }

        f({age: "foo"});
    });

    it("should blame the context for functions in an object contract", function() {
        @ ({g: (Num) -> Num}) -> Num
        function f(o) {
            return o.g(42);
        }

        f({g: function(x) {return "string";}});
    });

    it("should blame the context when not given an object", function() {
        @ ({s: Str}) -> Str
        function f(o) { return o.s; }

        f(42);
    });

    it("should allow optional contracts on an object", function() {
        @ ({foo: opt Str}) -> Str
        function f(o) { return "str"; }

        f({bar: 42});
    });

    it("should blame when an optional contract is violated for an object", function() {
        @ ({foo: opt Str}) -> Str
        function f(o) { return "str"; }

        f({foo: 42});

    })

    it("should blame a proxied object after it has been created", function() {
        @ (Num) -> !{age: Num}
        function makePerson(age) {
            return {age: age};
        }
        var p = makePerson(42);
        p.age = "string";
    });

    it("should blame the function when it uses a proxied object wrong", function() {
        @ (!{age: Num}) -> Num
        function f(o) {
            o.age = "42";
            return o.age;
        }

        f({age: 42});
    });

    it("should blame an array with the wrong field", function() {
        @ ([Str]) -> Num
        function f(arr) { return arr[0]; }

        f([1]);
    });

    it("should blame an array with missing fields", function() {
        @ ([Str, Num]) -> Num
        function f(arr) { return arr[0]; }

        f(["string"]);
    });

    it("should blame a proxied array", function() {
        @ (Num) -> ![Num]
        function makeArr(n) { return [n]; }

        var a = makeArr(42);
        a[0] = "string";
    });

    it("should blame an var length array", function() {
        @ ([...Num]) -> Num
        function f(arr) { return 42; }

        f([42, 100, 60000, "foo"]);
    });

    it("should not blame an empty var length array", function() {
        @ ([...Num]) -> Num
        function f(arr) { return 42; }

        f([]);
    });

    it("should blame a var length array with the repeat that comes first", function() {
        @ ([...Num, Str]) -> Str
        function f(arr) { return "str"; }

        f([100, 1000, "str"]);
    });

    it("should blame a proxied var length array", function() {
        @ (![...Num]) -> Num
        function f(arr) {
            arr[100] = "string";
            return 42;
        }

        f([42]);
    });


});
