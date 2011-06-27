/*global Proxy: true, */
/*jslint white: false, plusplus: false */

var Contracts = (function() {
    "use strict";
    function blame(toblame, k, val) {
        throw {
            name: "BlameError",
            message: "I blame: " + toblame + " for violating '" + k + "' with value: " + val
        };
    }

    // creates the properties that behave as an identity for a Proxy
    function idHandler(obj) {
        return {
            getOwnPropertyDescriptor: function(name) {
                var desc = Object.getOwnPropertyDescriptor(obj, name);
                if (desc !== undefined) { desc.configurable = true; }
                return desc;
            },
            getPropertyDescriptor: function(name) {
                var o = obj;
                // walk the prototype chain checking for the given property
                do {
                    var desc = Object.getOwnPropertyDescriptor(o, name); 
                    if (desc !== undefined) {
                        desc.configurable = true;
                        return desc;
                    }
                    o = Object.getPrototypeOf(o);
                } while(o !== null);
                return undefined;
            },
            getOwnPropertyNames: function() {
                return Object.getOwnPropertyNames(obj);
            },
            getPropertyNames: function() {
                return Object.getPropertyNames(obj);               
            },
            defineProperty: function(name, desc) {
                Object.defineProperty(obj, name, desc);
            },
            delete: function(name) { return delete obj[name]; },   

            fix: function() {
                if (Object.isFrozen(obj)) {
                    return Object.getOwnPropertyNames(obj).map(function(name) {
                        return Object.getOwnPropertyDescriptor(obj, name);
                    });
                }
                return undefined;
            },
            has: function(name) { return name in obj; },
            hasOwn: function(name) { return Object.prototype.hasOwnProperty.call(obj, name); },
            enumerate: function() {

                var result = [],
                name;
                for (name in obj) { result.push(name); }
                return result;
            },
            get: function(receiver, name) {
                return obj[name];
            },
            set: function(receiver, name, val) {
                obj[name] = val;
                return true;
            },
            keys: function() { return Object.keys(obj); }
        };
    }
    function Contract(cname, handler) {
        this.handler = handler
        this.cname = cname;
    }
    Contract.prototype = {
        // a -> (a + Blame)
        check : function(val) {
            return this.handler(val);
        },
        // (a -> (a + Blame)) -> Contract
        setHandler : function(handler) {
            this.handler = handler;
            return this;
        },
        // String x String -> Contract
        posNeg : function(pos, neg) {
            this.pos = pos;
            this.neg = neg;
            return this;
        }
    };

    // contract combinators
    var combinators = {
        flat: function(p, name) {
            return new Contract(name, function(val) {
                if (p(val)) {
                    return val;
                } else {
                    blame(this.pos, this.cname, val);
                }
            });
        },
        fun: function(dom, rng) {
            return new Contract(dom.cname + " -> " + rng.cname, function(f) {
                var handler = idHandler(f);
                var that = this; // right this?
                var fp = Proxy.createFunction(handler,
                                              function(args) {
                                                  var i = 0;
                                                  // todo: needs better handling of multi args
                                                  if(dom.posNeg !== undefined) {
                                                      // todo: what about single arg contract but
                                                      // function called with multiple arguments
                                                      dom.posNeg(that.neg, that.pos).check(args);
                                                  } else {
                                                      // assuming multiple arguments, should fail if assumption is wrong
                                                      // -- wish I could use some contracts here :)
                                                      for( ; i < args.length; i++) {
                                                          dom[i].posNeg(that.neg, that.pos).check(arguments[i]);
                                                      }
                                                  }
                                                  return rng.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                              },
                                              function(args) {
                                                  // todo: think through this more, how should we deal with constructors?
                                                  var rng, i;
                                                  for(i = 0; i < args.length; i++) {
                                                      dom[i].posNeg(that.neg, that.pos).check(args[i]);
                                                  }
                                                  return rng.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                              });
                fp.__cname = this.cname;
                return fp;
            });
        },
        object: function(objContract) {
            var c = new Contract("object", function(obj) {
                var missingProps, op,
                handler = idHandler(obj);
                var that = this;
                handler.get = function(receiver, name) {
                    if(that.oc.hasOwnProperty(name)) { 
                        return that.oc[name].posNeg(that.pos, that.neg).check(obj[name]);
                    } else {
                        return obj[name];
                    }
                };
                handler.set = function(receiver, name, val) {
                    if(that.oc.hasOwnProperty(name)) { 
                        obj[name] = that.oc[name].posNeg(that.pos, that.neg).check(val);
                    } else {
                        obj[name] = val;
                    }
                    return true;
                };
                // check that all properties on the object have a contract
                missingProps = Object.keys(this.oc).filter(function(el) {
                    // using `in` instead of `hasOwnProperty` to
                    // allow property to be somewhere on the prototype chain
                    // todo: are we sure this is what we want? need a way to specify
                    // a prop *must* be on the object?
                    return !(el in obj); 
                });
                if(missingProps.length !== 0) {
                    // todo: use missingProps to get more descriptive blame msg
                    blame(this.pos, this.oc, obj);
                }
                // making this a function proxy if object is also a function to preserve
                // typeof checks
                if (typeof obj === "function") {
                    op = Proxy.createFunction(handler,
                                              function(args) {
                                                  return obj.apply(this, arguments);
                                              },
                                              function(args) {
                                                  return obj.apply(this, arguments);
                                              });

                } else {
                    op = Proxy.create(handler);// todo: what about the prototype? defaulting to null
                }
                return op;
            });
            c.oc = objContract;
            c.addPropertyContract = function(newOc) {
                for(name in newOc) {
                    if(newOc.hasOwnProperty(name)) {
                        this.oc[name] = newOc[name];
                    }
                }
                return this;
            };
            return c;
        },
        any: (function() {
            return new Contract("any", function(val) {
                return val;
            });
        })(),
        or: function(k1, k2) {
            return new Contract("or", function(val) {
                // for now only accepting first order contracts for 'or'
                if (typeof val === "function") {
                    blame(this.pos, "or", val);
                }
                var k1c = k1.posNeg(this.pos, this.neg),
                    k2c = k2.posNeg(this.pos, this.neg);
                try {
                    return k1c.check(val);
                } catch (e) {
                    return k2c.check(val);
                }
            });
        },
        none: (function() {
            return new Contract("none", function(val) {
                blame(this.pos, "none", val);
            });
        })(),
        and: function(k1, k2) {
            return new Contract("and", function(val) {
                var k1c = k1.posNeg(this.pos, this.neg).check(val);
                return k2.posNeg(this.pos, this.neg).check(k1c);
            });
        },
        guard: function(k, x, pos, neg) {
            return k.posNeg(pos, neg).check(x);
        }
    },
    // Some basic contracts
    contracts = {
        Number: combinators.flat(function(x) {
            return typeof(x) === "number";
        }, "Number"),
        Boolean : combinators.flat(function(x) {
            return typeof(x) === "boolean";
        }, "Boolean"),
        String: combinators.flat(function(x) {
            return typeof(x) === "string";
        }, "String"),
        Odd: combinators.flat(function(x) {
            return  (x % 2) === 1;
        }, "Odd"),
        Even: combinators.flat(function(x) {
            return (x % 2) === 1;
        }, "Even"),
        Pos: combinators.flat(function(x) {
            return x >= 0;
        }, "Pos"),
        Array: combinators.object({
            length: combinators.flat(function(x) {
                return typeof(x) === "number";
            }, "Number")
        })
    };
    return {
        C: combinators,
        K: contracts
    };
})();
