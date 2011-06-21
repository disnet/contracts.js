/*global jQuery: true, Contracts: true */

// add contracts to jQuery
jQuery.foo = 45;
jQuery = Contracts.C.guard(
    Contracts.C.object({
        myVerySpecialProperty: Contracts.K.Number
    }), jQuery, "server", "client");
