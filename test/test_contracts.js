var expect = require("expect.js");
import @ from "contracts.js";



describe("contracts", function() {
    it("should blame the context when call wrong", function() {
        @ (Num) -> Num
        function numId(x) { return x; }

        expect(numId(42)).to.be(42);
        expect(function() { numId("string"); }).to.throwError();
        numId('foo');
    });

    it("should blame function when it goes wrong", function() {
        @ (Num) -> Num
        function numId(x) { return "foo"; }

        expect(function() { numId(42); }).to.throwError();
        numId(42);
    });
});
