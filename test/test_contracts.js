import @ from "contracts.js";


describe("contracts", function() {
    it("should do what I want", function() {
        @ (Num) -> Num
        function numId(x) { return x; }

        expect(numId(42)).to.be(42);
        expect(function() { numId("string"); }).to.throwError();
    });
});
