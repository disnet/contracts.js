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
        @(Num, Str) -> Num
        function f(x, y) { return x; }

        f(42, 42);
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
});
