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

    it("should correctly blame in the higher-order case", function() {
        @ ((Num) -> Num) -> Num
        function numApp(f) {
            return f(42);
        }

        expect(numApp(function(x) {
            return x;
        })).to.be(42);
        expect(function() {
            numApp(function(x) {
                return "string";
            });
        }).to.throwError();
    });

    it("should blame the context for object contracts", function() {
        @ ({age: Num}) -> Num
        function f(o) { return o.age; }

        f({age: "foo"});
    });

    it("should blame when using a polymorphic type variable", function() {
        @ (a) -> a
        function f(x) { return x; }
    });
});
