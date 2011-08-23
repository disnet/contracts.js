Contracts.js is a contract library for JavaScript.

To use include the files:
 - src/stacktrac.js
 - src/contracts.js
 - src/autoload.js

Then your code can use contracts:

var C = Contracts.combinators;
var id = C.guard(
          C.fun(Num, Num),
          function(x) { return x; });

id = id.use();
id("foo"); // contract violation!

More documentation and rational can be found at
the sister project [contracts.coffee](http://disnetdev.com/contracts.coffee/).

Note that this library requires Proxies so it currently
only works for Firefox 4+ (though Proxy support in other
JavaScript engines is coming soon).
