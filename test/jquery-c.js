/*global jQuery: true, Contracts: true */

// add contracts to jQuery
jQuery.myVerySpecialProperty = "hi";
jQuery = Contracts.C.guard(
    Contracts.C.object({
        myVerySpecialProperty: Contracts.K.Number
    }), jQuery, "server", "client");
