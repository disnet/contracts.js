var Contracts = (function() {
    "use strict";

    // [Str, Contract, any] -> \bot
    function blame(toblame, contract, value, parentKs) {
        var msg = "Contract violation: expected <" + contract.cname + ">"
                + ", actual: " + (typeof(value) === "string" ? '"' + value + '"' : value)+ "\n"
                + "Blame is on " + toblame + "\n";

        if(parentKs) {
            msg += "parent contracts:\n" + parentKs.reverse().join("\n");
        }
        // msg += "value initially guarded at: " + contract.getGuardSite();
        // this.prototype = Error.prototype;
        // this.message = msg;
        // this.atFault = toblame;
        var er = new Error(msg);
        var st = printStackTrace({e : er});
        er.message += "\n\n" + st.join("\n") ;

        throw er;
    }

    // merges props of o2 into o1 return o1
    function merge(o1, o2) {
        var o3 = {};
        var f = function(o) {
            for(var name in o) {
                if(o.hasOwnProperty(name)) {
                    o3[name] = o[name];
                }
            }
        };
        f(o1);
        f(o2);
        return o3;
    };

    function hasNoHoles(obj) {
        var i = 0;
        for( ; i < obj.length; i++) {
            if(!(i in obj))
                return false;
        }
        return true;
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
        this.handler = handler;
        this.cname = cname;
        this.parent = null;
    }
    Contract.prototype = {
        check : function check(val, pos, neg, parentKs) {
            return this.handler(val, pos, neg, parentKs);
        },
        toString: function() {
            return this.cname;
        }
    };

    // (any -> Bool), [Str] -> Contract
    // todo: maybe change name to assert?
    function check(p, name) {
        return new Contract(name, function check(val, pos, neg, parentKs) {
            if (p(val)) {
                return val;
            } else {
                blame(pos, this, val, parentKs);
            }
        });
    };

    // (Contract or arr(Contract)),     -- The domain contract - use array for multiple arguments
    // ((any -> Contract) or Contract), -- The range contract - function if dependent 
    // Opt({                            -- Options object
    //   callOnly: Bool                 -- only allowed to call without new (this and newOnly cannot both be true)
    //   newOnly: Bool                  -- only allowed to call with new (this and callOnly cannot both be true)
    //   pre: (any -> Bool)             -- pre condition predicate
    //   post: (any -> Bool)            -- post condition predicate
    //   this: object{...})             -- object contract to check 'this'
    // })                     
    // -> Contract                      -- Resulting contract
    // OR
    // {
    //   call: arr(Contract or arr(Contract), Contract),
    //   new: arr(Contract or arr(Contract), Contract)
    // }
    // -> Contract
    function fun(dom, rng, options) {
        var callOnly, newOnly, cleanDom, domname,
            newdom, newrng, calldom, callrng;

        cleanDom = function(dom) {
            // wrap the domain in array so we can be consistent
            if (dom instanceof Contract) { 
                dom = [dom];
            }
            // don't allow required argument contracts to follow optional
            dom.reduce(function(prevWasOpt, curr) {
                if(curr.cname === "opt") {
                    return true;
                } else {
                    if(prevWasOpt) {
                        throw "Illagal arguments: required argument following an optional argument.";
                    } else {
                        return false;
                    }
                }
            }, false);
            return dom;
        };

        // dom is overloaded so check if was called as
        // an object with the contracts for call/new
        if(dom && dom.call && dom.new) {
            // different rng/dom for call/new
            calldom = cleanDom(dom.call[0]);
            callrng = dom.call[1];
            newdom = cleanDom(dom.new[0]);
            newrng = dom.new[1];
            options = rng || {};
        } else {
            // rng/dom for call/new are the same
            calldom = cleanDom(dom);
            callrng = rng;
            newdom = calldom;
            newrng = callrng;
            options = options || {};
        }

        callOnly = options && options.callOnly;
        newOnly = options && options.newOnly;

        // todo: turn this into an example contract
        if(callOnly && newOnly) {
            throw "Cannot have a function be both newOnly and newSafe";
        }

        if(newOnly && options.this) {
            throw "Illegal arguments: cannot have both newOnly and a contract on 'this'";
        }
        domname = "(" + calldom.join(",") + ")";

        // todo: better name for case when we have both call and new contracts
        return new Contract(domname + " -> " + callrng.cname, function(f, pos, neg, parentKs) {
            // todo: check that f is actually a function
            if(typeof f !== "function") {
                blame(pos, this, f, parentKs); 
            }
            var handler = idHandler(f);
            var that = this; 
            var callHandler, newHandler;

            // options:
            // { isNew: Bool   - make a constructor handler (to be called with new)
            //   newSafe: Bool - make call handler that adds a call to new
            //   pre: ({} -> Bool) - function to check preconditions
            //   post: ({} -> Bool) - function to check postconditions
            //   this: {...} - object contract to check 'this'
            // }
            var makeHandler = function(dom, rng, options) {
                return function functionHandler() {
                    var i, res, args = [], boundArgs, bf, thisc;

                    // check pre condition
                    if(typeof options.pre === "function") {
                        if(!options.pre(this)) {
                            blame(pos, that, "precond");  // todo: fix up blame message
                        }
                    }

                    var parents = parentKs.slice(0);
                    parents.push(that);
                    // check all the arguments
                    for( i = 0; i < dom.length; i++) { 
                        // might pass through undefined which is fine (opt will take
                        // care of it if the argument is actually optional)
                        //
                        // blame is reversed
                        args[i] = dom[i].check(arguments[i], neg, pos, parents);
                        // assigning back to args since we might be wrapping functions/objects
                        // in delayed contracts
                    }

                    if(typeof rng === "function") {
                        // send the arguments to the dependent range
                        rng = rng.apply(this, args);
                    }

                    // apply the function and check its result
                    if(options.isNew || options.newSafe) {
                        // null is in the 'this' argument position for bind...
                        // bind will ignore the supplied 'this' when we call it with new 
                        boundArgs = [].concat.apply([null], args);
                        bf = f.bind.apply(f, boundArgs);
                        res = new bf();
                        res = rng.check(res, pos, neg, parents);
                    } else {
                        if(options.this) {
                            thisc = options.this.check(this, pos, neg, parents);
                        } else {
                            thisc = this;
                        }
                        res = rng.check(f.apply(thisc, args), pos, neg, parents);
                    }

                    // check post condition
                    if(typeof options.post === "function") {
                        if(!options.post(this)) {
                            blame(pos, "fun", "postcond"); // todo: fix up blame message
                        }
                    }
                    return res;
                };
            };

            if(newOnly) {
                options.isNew = true;
                callHandler = function() {
                    blame(pos, that, "new only", parentKs);
                };
                newHandler = makeHandler(newdom, newrng, options);
            } else if(callOnly) {
                options.isNew = false;
                newHandler = function() {
                    blame(pos, that, "call only", parentKs);
                };
                callHandler = makeHandler(calldom, callrng, options);
            } else { // both false...both true is a contract construction-time error and handled earlier
                callHandler = makeHandler(calldom, callrng, options);
                newHandler = makeHandler(newdom, newrng, options);
            }
            var fp = Proxy.createFunction(handler, callHandler, newHandler);
            fp.__cname = this.cname;
            return fp;
        });
    };


    function ctor(dom, rng, options) {
        var opt = merge(options, {newOnly: true});
        return fun(dom, rng, opt);
    };

    function ctorSafe(dom, rng, options) {
        var opt = merge(options, {newSafe: true});
        return fun(dom, rng, opt);
    };

    function object(objContract, options) {
        options = options || {};
        // todo watch out for cycles
        var objName = function(obj) {
            var props = Object.keys(obj).map(function(propName) {
                return propName + " : " + obj[propName].cname;
            }, this);
            return "{" + props.join(", ") + "}";
        };

        var c = new Contract(objName(objContract), function(obj, pos, neg, parentKs) {
            var missingProps, op, i, name,
                handler = idHandler(obj);
            var that = this;
            var parents = parentKs.slice(0);
            parents.push(this);
            
            if(!(obj instanceof Object)) {
                blame(pos, this, obj);
            }
            if(options.extensible === true && !Object.isExtensible(obj)) {
                blame(pos, "object", "not a extensible object");
            }
            if(options.extensible === false && Object.isExtensible(obj)) {
                blame(pos, "object", "extensible object");
            }
            if(options.sealed === true && !Object.isSealed(obj)) {
                blame(pos, "object", "not a sealed object");
            }
            if(options.sealed === false && Object.isSealed(obj)) {
                blame(pos, "object", "sealed object");
            }
            if(options.frozen === true && !Object.isFrozen(obj)) {
                blame(pos, "object", "not a frozen object");
            }
            if(options.frozen === false && Object.isFrozen(obj)) {
                blame(pos, "object", "frozen object");
            }

            for(name in this.oc) {
                // wrap all object contract in a prop descriptor like object
                // for symmetry with descriptor contracts
                if(this.oc[name] instanceof Contract) {
                    this.oc[name] = {value : this.oc[name]};
                }
            }

            handler.defineProperty = function(name, desc) {
                if(!options.extensible || options.sealed || options.frozen) {
                    blame(pos, obj, "object is non-extensible");
                }
                Object.defineProperty(obj, name, desc);
            };
            handler.delete = function(name) {
                if(options.sealed || options.frozen) {
                    blame(pos, obj, "object is " + (options.sealed ? "sealed" : "frozen"));
                }
                return delete obj[name]; 
            };
            handler.get = function(receiver, name) {
                if(that.oc.hasOwnProperty(name)) { 
                    return that.oc[name].value.check(obj[name], pos, neg, parents);
                } else {
                    return obj[name];
                }
            };
            handler.set = function(receiver, name, val) {
                if(!options.extensible && Object.getOwnPropertyDescriptor(obj, name) === undefined) {
                    blame(pos, obj, "non-extensible object");
                }
                if(options.frozen) {
                    // normally would silengtly fail or throw a type error (strict mode)
                    // but now we throw blame for better messaging
                    blame(pos, obj, "frozen object");
                }
                if(that.oc.hasOwnProperty(name)) { 
                    obj[name] = that.oc[name].value.check(val, pos, neg, parents);
                } else {
                    obj[name] = val;
                }
                return true;
            };
            if(options && options.noDelete) {
                handler.delete = function(name) {
                    blame(pos, that.oc[name].value, obj);
                };
            }
            // check that all properties on the object have a contract
            missingProps = Object.keys(this.oc).filter(function(el) {
                var objDesc;
                // if it's the optional contract ignore
                if(that.oc[el].value.cname === "opt") {
                    return false;
                }

                objDesc = Object.getOwnPropertyDescriptor(obj, el);
                if(objDesc !== undefined) {
                    if( (that.oc[el].writable === true && !objDesc.writable)
                        || (that.oc[el].writable === false && objDesc.writable)) {
                        blame(pos, obj, "writable descriptor doesn't match contract");
                    }
                    if( (that.oc[el].configurable === true && !objDesc.configurable)
                        || (that.oc[el].configurable === false && objDesc.configurable)) {
                        blame(pos, obj, "configurable descriptor doesn't match contract");
                    }
                    if( (that.oc[el].enumerable === true && !objDesc.enumerable)
                        || (that.oc[el].enumerable === false && objDesc.enumerable)) {
                        blame(pos, obj, "configurable descriptor doesn't match contract");
                    }
                }
                // using `in` instead of `hasOwnProperty` to
                // allow property to be somewhere on the prototype chain
                // todo: are we sure this is what we want? need a way to specify
                // a prop *must* be on the object?
                return !(el in obj); 
            });
            if(missingProps.length !== 0) {
                // todo: use missingProps to get more descriptive Blame msg
                blame(pos, this.oc, obj);
            }
            // todo eagerly check the properties?

            if(options && options.initPredicate) {
                // check each predicate if we have more than one
                if(Array.isArray(options.initPredicate)) {
                    for( i = 0; i < options.initPredicate.length; i++) {
                        if(!options.initPredicate[i](obj))
                            blame(pos, this.oc, obj);
                    }
                } else {
                    if(!options.initPredicate(obj))
                        blame(pos, this.oc, obj);
                }
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
                op = Proxy.create(handler, Object.prototype); // todo: is this the proto we actually want?
            }
            return op;
        });
        c.oc = objContract;
        // Allows us to add property's to the object
        // contract after initialization. Useful for
        // recursive contracts.
        c.addPropertyContract = function(newOc) {
            var name;
            for(name in newOc) {
                if(newOc.hasOwnProperty(name)) {
                    this.oc[name] = newOc[name];
                }
            }
            return this;
        };
        return c;
    };

    function arr(ks) {
        var i, getC, oc = {};
        for(i = 0; i < ks.length; i++) {
            if(typeof ks[i] === "function") {
                if(i !== ks.length - 1) {
                    throw "___() must be at the last position in the array";
                }
                getC = ks[i](i);
            }
            oc[i] = ks[i];
        }
        return object(oc, {getContract: getC});
    };

    function ___(k) {
        return function(index) {
            return function(propName, arrLength) {
                var propIndex = parseInt(propName, 10);
                if(propIndex >= index && propIndex < arrLength) {
                    return k;
                }
                return null;
            };
        };
    };

    var any = (function any() {
        return new Contract("any", function(val) {
            return val;
        });
    })();

    function or(ks) {
        // todo: could be nicer here and use arguments to accept varargs
        if(!Array.isArray(ks)) {
            throw {
                name: "BadContract",
                message: "Must create the 'or' contract with an array of contracts"
            };
        }
        return new Contract("or", function(val, pos, neg, parentKs) {
            var i = 0, lastBlame;
            // for now only accepting first order contracts for 'or'
            if (typeof val === "function") {
                blame(pos, "or", val);
            }
            for(; i < ks.length; i++) {
                try {
                    return ks[i].check(val, pos, neg, parentKs);
                } catch (e) {
                    lastBlame = e;
                    continue;
                }
            }
            throw lastBlame; // the last contract in the array still assigned blame so surface it
        });
    };
    
    var none = (function none() {
        return new Contract("none", function(val, pos, neg, parentKs) {
            blame(pos, this, val, parentKs);
        });
    })();

    function and(k1, k2) {
        return new Contract("and", function(val, pos, neg, parentKs) {
            var k1c = k1.check(val, pos, neg, parentKs);
            return k2.check(k1c, pos, neg, parentKs);
        });
    };

    function opt(k) {
        return new Contract("opt", function(val, pos, neg, parentKs) {
            if(val === undefined) { // unsuplied arguments are just passed through
                return val;
            } else {
                // arg is actually something so check the underlying contract
                return k.check(val, pos, neg, parentKs);
            }
        });
    };

    function guard(k, x, pos, neg) {
        if(!pos) {
            // if(x.name === "") {
            //     pos = x.toString();
            // } else {
            //     pos = x.name; 
            // }
            var guardedAt = printStackTrace({e: new Error()})[1];
            pos = "value guarded at: " + guardedAt;
            neg = "client of " + pos;
        }
        if(pos && !neg) {
            neg = "client of " + pos;
        }
        // k.setGuardSite(guardedAt);
        return k.check(x, pos, neg, []);
    };

    var combinators = {
        check: check,
        fun: fun,
        ctor: ctor,
        ctorSafe: ctorSafe,
        object: object,
        arr: arr,
        ___: ___,
        any: any,
        or: or,
        none: none,
        and: and,
        opt: opt,
        guard: guard
    };

    // Some basic contracts
    var contracts = {
        Undef: combinators.check(function(x) {
            return undefined === x;
        }, "Undefined"),
        Null : combinators.check(function(x) {
            return null === x;
        }, "Null"),
        Num: combinators.check(function(x) {
            return typeof(x) === "number";
        }, "Number"),
        Bool: combinators.check(function(x) {
            return typeof(x) === "boolean";
        }, "Boolean"),
        Str: combinators.check(function(x) {
            return typeof(x) === "string";
        }, "String"),
        Odd: combinators.check(function(x) {
            return  (x % 2) === 1;
        }, "Odd"),
        Even: combinators.check(function(x) {
            return (x % 2) !== 1;
        }, "Even"),
        Pos: combinators.check(function(x) {
            return x >= 0;
        }, "Pos"),
        Arr: combinators.object({
            length: combinators.check(function(x) {
                return typeof(x) === "number";
            }, "Number")
        })
        // come back to these later...sort of want
        // to actively freeze the objects coming in
        // not just check that they have been frozen (maybe)

        // List: combinators.object({}, {
        //     frozen: true,
        //     noDelete: true,
        //     initPredicate: [Array.isArray, hasNoHoles]
        // }),
        // SaneArray: combinators.object({}, {
        //     frozen: false,
        //     noDelete: true,
        //     initPredicate: [Array.isArray, hasNoHoles]
        // }),
        // JsArray: combinators.object({}, {
        //     frozen: false,
        //     noDelete: false,
        //     initPredicate: Array.isArray
        // })
    };
    return {
        combinators: combinators,
        contracts: contracts
    };
})();
