/*global M: true, document:true, $:true test:true, ok:true, raises: true*/
$(document).ready(function() {
    
    test("checking id", function() {
        ok(M.id(3));

        raises(function() { M.idNone(3); });
    });

    test("checking abs", function() {
        ok(M.abs(4));

        raises(function() { M.abs("foo"); });
        raises(function() { M.badAbs(-4); });
    });

    test("checking object", function() {
        ok(M.idObj.id(3));

        raises(function() { M.idObj.id("hi"); });
    });

    test("checking jquery", function() {
        ok($.foo === 45);
    });
});
