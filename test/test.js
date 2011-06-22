/*global M: true, document:true, $:true test:true, ok:true, raises: true, jQuery: true, Contracts: true */

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
    raises(function() { jQuery.myVerySpecialProperty; });
    // Note: different than real test...jQuery.noConflict will return the original
    // non-proxied non-contracted version of the jQuery object
    notEqual( jQuery, jQuery.noConflict(), "noConflict returned the jQuery object" );
});
