/*global jQuery: true, Contracts: true */

// add contracts to jQuery
// jQuery.myVerySpecialProperty = "hi";
// jQuery = Contracts.C.guard(
//     Contracts.C.object({
//         myVerySpecialProperty: Contracts.K.Number
//     }), jQuery, "server", "client");
jQuery = (function() {
    var C = Contracts.C,
        K = Contracts.K,
        jQueryContract = C.object({
            length : K.Number
        });
    jQueryContract.addPropertyContract({
        // addClass :: String -> jQuery
        addClass : C.fun(K.String, jQueryContract)
    });

    return C.guard(
        C.and(
            jQueryContract,
            C.fun(C.any, jQueryContract)
        ),
        jQuery,
        "server",
        "client");
})();
