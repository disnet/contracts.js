/**
 * contracts.coffee
 * http://disnetdev.com/contracts.coffee
 *
 * Copyright 2011, Tim Disney
 * Released under the MIT License
 */
var Contracts = (function() {
    "use strict";

    var enabled = true,
        // [...{ proxy: Proxy, contract: Contract }]
        unproxy = [];

    unproxy = (function() {
        var unproxy, weak;
        if(typeof(WeakMap) !== 'undefined') {
            weak = true;
            unproxy = new WeakMap();
        } else {
            weak = false;
            unproxy = [];
        }
        return {
            // (Proxy, Contract) -> Unit
            set: function(p, c) {
                if(weak) {
                    unproxy.set(p, c);
                } else {
                    unproxy.push({proxy: p, contract: c});
                }
            },
            // (Proxy) -> Contract or Undefined
            get: function(p) {
                var pc;
                if(weak) {
                    if((p !== null) && typeof p === "object" || typeof p === "function") {
                        return unproxy.get(p);
                    } else {
                        return undefined;
                    }
                } else {
                    pc = unproxy.filter(function(el) { return p === el.proxy; });
                    if(pc.length > 1) {
                        throw "assumption failed: unproxy object stores multiple unique proxies";
                    }
                    if(pc.length === 1) {
                        return pc[0];
                    } else {
                        return undefined;
                    }
                }
            }
        };
    })();
    var Utils = {
        // walk the proto chain to get the property descriptor
        getPropertyDescriptor : function getPropertyDescriptor(obj, prop) {
            var o = obj;
            do {
                var desc = Object.getOwnPropertyDescriptor(o, prop); 
                if (desc !== undefined) {
                    return desc;
                }
                o = Object.getPrototypeOf(o);
            } while(o !== null);
            return undefined;
        },

        // merges props of o2 into o1 return o1
        merge : function merge(o1, o2) {
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
        },

        hasNoHoles : function hasNoHoles(obj) {
            var i = 0;
            for( ; i < obj.length; i++) {
                if(!(i in obj))
                    return false;
            }
            return true;
        },

        // if a1 and a2 are differently sized, return the empty list
        zip: function(a1, a2) {
            var i, ret = [];
            if(!Array.isArray(a1) || !Array.isArray(a2) || (a1.length !== a2.length)) {
                ret = [];
            } else {
                for(i = 0; i < a1.length; i++) {
                    ret.push([a1[i], a2[i]]);
                }
            }
            return ret;
        }
    };

    function checkOptions(a, b) {
        var name, pOpt = true;
        for(name in a) {
            if(a[name] instanceof Contract) {
                if(!a[name].equals(b[name])) {
                    pOpt = false;
                }
            } else if(a[name] !== b[name]) {
                pOpt = false;
            }
        }
        for(name in b) {
            if(!(name in a)) {
                pOpt = false;
            }
        }
        return pOpt;
    }


    // Parses out filename and line number. Expects an array where the 0th entry
    // is the file location and line number
    // [...Str] -> [Str, Num] or null
    function findCallsite(trace) {
        var match, t = trace[0],
            // string looks like {adsf}@file:///path/to/file.js:42
            re = /@(.*):(\d*)$/;
        match = re.exec(t);
        if(match) {
            return [match[1], parseInt(match[2], 10)];
        } else {
            return null;
        }
    }

    // (ModuleName, ModuleName, Str, [Contract]) -> \bot
    function _blame(toblame, other, msg, parents) {
        var server, err, st, callsite, ps = parents.slice(0);
        server = toblame.isServer ? toblame : other;
        var m = "Contract violation: " + msg + "\n"
                + "Value guarded in: " + server + " -- blame is on: " + toblame + "\n";

        if(ps) {
            m += "Parent contracts:\n" + ps.reverse().join("\n");
        }

        err =  new Error(m);
        st = printStackTrace({e : err});
        err.cleaned_stacktrace = st;

        // pretend the error was thrown at the place in usercode where the violation occured
        callsite = findCallsite(st);
        if(callsite) {
            // by setting these fields tools like firebug will link to the
            // appropriate place in the user code
            err.fileName = callsite[0];
            err.lineNumber = callsite[1];
        }
        throw err;
    }

    // (ModuleName, ModuleName, Contract, any, [Contract]) -> \bot
    function blame(toblame, other, contract, value, parents) {
        var cname = contract.cname || contract;
        var msg = "expected <" + cname + ">"
                + ", actual: " + (typeof(value) === "string" ? '"' + value + '"' : value);

        throw _blame(toblame, other, msg, parents);
    }

    function blameM(toblame, other, msg, parents) {
        _blame(toblame, other, msg, parents);
    }

    // creates an identity proxy handler
    function idHandler(obj) {
        return {
            getOwnPropertyDescriptor: function(name) {
                var desc = Object.getOwnPropertyDescriptor(obj, name);
                if (desc !== undefined) { desc.configurable = true; }
                return desc;
            },
            getPropertyDescriptor: function(name) {
                var desc = Utils.getPropertyDescriptor(obj, name);
                if(desc) {
                    desc.configurable = true;
                }
                return desc;
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
    function Contract(cname, ctype, handler) {
        this.handler = handler;
        this.cname = cname;
        this.ctype = ctype;
        this.parent = null;
    }
    Contract.prototype = {
        check : function check(val, pos, neg, parentKs, stack) {
            var c = unproxy.get(val);
            if(c && c.equals(this)) {
                // don't bother wrapping twice though we want to run the handler
                // for the initialization check that happens and just ignore the return
                this.handler(val, pos, neg, parentKs, stack);
                return val;
            } else {
                return this.handler(val, pos, neg, parentKs, stack);
            }
        },
        toContract: function() {
            return this;  
        },
        toString: function() {
            return this.cname;
        },
        equals: function(other) {
            throw "Equality checking must be overridden";
        }
    };

    // (Str, Str, Bool) ==> ModuleName
    function ModuleName(filename, linenum, isServer) {
        this.filename = filename;
        this.linenum = linenum;
        this.isServer = isServer;
    }
    ModuleName.prototype.toString = function() {
        return this.filename + (this.linenum === "" ? "" : (":" + this.linenum));
    };

    Function.prototype.toContract = function() {
        var name = "<user defined: " + this.toString() + ">";
        return check(this, name);
    };


    // ((any, Stack?) -> Bool), [Str] -> Contract
    function check(p, name) {
        var c;
        c = new Contract(name, "check", function check(val, pos, neg, parentKs, stack) {
            if (p(val, stack)) {
                return val;
            } else {
                blame(pos, neg, this, val, parentKs);
            }
        });
        c.equals = function(other) {
            return (this.cname === other.cname) &&
                (this.handler === other.handler);
        };
        return c;
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
        var callOnly, newOnly, cleanDom, domName, optionsName, contractName,
            newdom, newrng, calldom, callrng, c;

        cleanDom = function(dom) {
            // wrap the domain in array so we can be consistent
            if (dom instanceof Contract) { 
                dom = [dom];
            }
            // don't allow required argument contracts to follow optional
            dom.reduce(function(prevWasOpt, curr) {
                if(curr.ctype === "opt") {
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

        domName = "(" + calldom.join(",") + ")";
        optionsName = (options.this ? "{this: " + options.this.cname + "}" : "");
        contractName = domName + " -> " + callrng.cname + " " + optionsName;

        c = new Contract(contractName, "fun", function(f, pos, neg, parentKs, stack) {
            var callHandler, newHandler,
                handler = idHandler(f),
                that = this,
                parents = parentKs.slice(0),
                p;

            if(typeof f !== "function") {
                blame(pos, neg, this, f, parents); 
            }

            parents.push(that);

            // options:
            // { isNew: Bool   - make a constructor handler (to be called with new)
            //   newSafe: Bool - make call handler that adds a call to new
            //   pre: ({} -> Bool) - function to check preconditions
            //   post: ({} -> Bool) - function to check postconditions
            //   this: {...} - object contract to check 'this'
            // }
            var makeHandler = function(dom, rng, options) {
                return function functionHandler() {
                    var i, res,
                        args = [],
                        boundArgs, bf, thisc, clean_rng;

                    if (options && options.checkStack && !(options.checkStack(stack))) {
                        throw new Error("stack checking failed");
                    }
                    // check pre condition
                    if(typeof options.pre === "function") {
                        if(!options.pre(this)) {
                            blame(neg, pos, "precondition: " + options.pre.toString(), "[failed precondition]", parents);  
                        }
                    }

                    // check all the arguments
                    for( i = 0; i < dom.length; i++) { 
                        // might pass through undefined which is fine (opt will take
                        // care of it if the argument is actually optional)
                        //
                        // blame is reversed
                        args[i] = dom[i].check(arguments[i], neg, pos, parents, stack);
                        // assigning back to args since we might be wrapping functions/objects
                        // in delayed contracts
                    }

                    if(typeof rng === "function") {
                        // send the arguments to the dependent range
                        clean_rng = rng.apply(this, args);
                    } else {
                        clean_rng = rng;
                    }

                    // apply the function and check its result
                    if(options.isNew || options.newSafe) {
                        // null is in the 'this' argument position for bind...
                        // bind will ignore the supplied 'this' when we call it with new 
                        boundArgs = [].concat.apply([null], args);
                        bf = f.bind.apply(f, boundArgs);
                        res = new bf();
                        res = clean_rng.check(res, pos, neg, parents, stack);
                    } else {
                        if(options.this) {
                            // blame is reversed
                            thisc = options.this.check(this, neg, pos, parents, stack);
                        } else {
                            thisc = this;
                        }
                        res = clean_rng.check(f.apply(thisc, args), pos, neg, parents, stack);
                    }

                    // check post condition
                    if(typeof options.post === "function") {
                        if(!options.post(this)) {
                            blame(neg, pos, "failed postcondition: " + options.post.toString(),
                                  "[failed postcondition]",
                                  parents);  
                        }
                    }
                    return res;
                };
            };

            if(newOnly) {
                options.isNew = true;
                callHandler = function() {
                    blameM(neg, pos, "called newOnly function without new", parents);
                };
                newHandler = makeHandler(this.newdom, this.newrng, options);
            } else if(callOnly) {
                options.isNew = false;
                newHandler = function() {
                    blameM(neg, pos, "called callOnly function with a new", parents);
                };
                callHandler = makeHandler(this.calldom, this.callrng, options);
            } else { // both false...both true is a contract construction-time error and handled earlier
                callHandler = makeHandler(this.calldom, this.callrng, options);
                newHandler = makeHandler(this.newdom, this.newrng, options);
            }

            p = Proxy.createFunction(handler, callHandler, newHandler);
            unproxy.set(p, this);
            return p;
        });
        c.calldom = calldom;
        c.callrng = callrng;
        c.newdom = newdom;
        c.newrng = newrng;
        c.raw_options = options;
        c.equals = function(other) {
            var name, zipCDom, zipNDom, pCDom, pNDom, pOpt;
            // can can short circuit here if we're not testing against another contract
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            zipCDom = Utils.zip(this.calldom, other.calldom);
            zipNDom = Utils.zip(this.newdom, other.newdom);
            pCDom = (zipCDom.length !== 0) && zipCDom.every(function(zd) {
                return zd[0].equals(zd[1]);
            });
            pNDom = (zipNDom.length !== 0) && zipNDom.every(function(zd) {
                return zd[0].equals(zd[1]);
            });

            // this will "fail" equality testing if the options object has
            // pre/post functions that are the "same" but not the same reference
            pOpt = checkOptions(this.raw_options, other.raw_options);
            return pOpt &&
                pCDom &&
                pNDom &&
                (this.callrng.equals(other.callrng)) &&
                (this.newrng.equals(other.newrng));
        };
        return c;
    };


    function ctor(dom, rng, options) {
        var opt = Utils.merge(options, {newOnly: true});
        return fun(dom, rng, opt);
    };

    function ctorSafe(dom, rng, options) {
        var opt = Utils.merge(options, {newSafe: true});
        return fun(dom, rng, opt);
    };

    function object(objContract, options, name) {
        options = options || {};

        var objName = function(obj) {
            if(name === undefined) {
                var props = Object.keys(obj).map(function(propName) {
                    if(obj[propName].cname) {
                        return propName + " : " + obj[propName].cname;
                    } else {
                        return propName + " : " + obj[propName].value.cname;
                    }
                }, this);
                return "{" + props.join(", ") + "}";
            } else {
                return name;       
            }
        };



        var c = new Contract(objName(objContract), "object", function(obj, pos, neg, parentKs) {
            var missingProps, op, i, prop, contractDesc, objDesc, value,
                handler = idHandler(obj);
            var that = this;
            var parents = parentKs.slice(0);
            var invariant;
            parents.push(this);

            if(!(obj instanceof Object)) {
                blame(pos, neg, this, obj, parentKs);
            }
            if(options.extensible === true && !Object.isExtensible(obj)) {
                blame(pos, neg, "[extensible object]", "[non-extensible object]", parents);
            }
            if(options.extensible === false && Object.isExtensible(obj)) {
                blame(pos, neg, "[non-extensible]", "[extensible object]", parents);
            }
            if(options.sealed === true && !Object.isSealed(obj)) {
                blame(pos, neg, "[sealed object]", "[non-sealed object]", parents);
            }
            if(options.sealed === false && Object.isSealed(obj)) {
                blame(pos, neg, "[non-sealed object]", "[sealed object]", parents);
            }
            if(options.frozen === true && !Object.isFrozen(obj)) {
                blame(pos, neg, "[frozen object]", "[non-frozen object]", parents);
            }
            if(options.frozen === false && Object.isFrozen(obj)) {
                blame(pos, neg, "[non-frozen object]", "[frozen object]", parents);
            }

            // do some cleaning of the object contract...
            // in particular wrap all object contract in a prop descriptor like object
            // for symmetry with user defined contract property
            // descriptors: object({ a: Num }) ==> object({ a: {value: Num} })
            for(prop in this.oc) {
                // todo: commenting out for now to allow us to have an object contract prototype chain
                // only reason not too allow this is if the user puts something silly on the chain. 
                // if(!this.oc.hasOwnProperty(prop)) {
                //     continue; 
                // }

                contractDesc = this.oc[prop];
                objDesc = Utils.getPropertyDescriptor(obj, prop);

                // pull out the contract (might be direct or in a descriptor like {value: Str, writable: true})
                if(contractDesc instanceof Contract) {
                    value = contractDesc;
                } else {
                    // case when defined as a contract property descriptor
                    if(contractDesc.value) {
                        value = contractDesc.value;
                    } else {
                        // something other than a descriptor
                        blameM(pos, neg, "contract property descriptor missing value property", parents);
                    }
                }

                if(objDesc) {
                    // check the contract descriptors agains what is actually on the object
                    // and blame where apropriate
                    if(contractDesc.writable === true && !objDesc.writable) {
                        blame(pos, neg, "[writable property: " + prop + "]", "[read-only property: " + prop + "]", parents);
                    }
                    if (contractDesc.writable === false && objDesc.writable) {
                        blame(pos, neg, "[read-only property: " + prop + "]", "[writable property: " + prop + "]", parents);
                    }
                    if(contractDesc.configurable === true && !objDesc.configurable) {
                        blame(pos, neg, "[configurable property: " + prop + "]", "[non-configurable property: " + prop + "]", parents);
                    }
                    if(contractDesc.configurable === false && objDesc.configurable) {
                        blame(pos, neg, "[non-configurable property: " + prop + "]", "[configurable property: " + prop + "]", parents);
                    }
                    if(contractDesc.enumerable === true && !objDesc.enumerable) {
                        blame(pos, neg, "[enumerable property: " + prop + "]", "[non-enumerable property: " + prop + "]", parents);
                    }
                    if(contractDesc.enumerable === false && objDesc.enumerable) {
                        blame(pos, neg, "[non-enumerable property: " + prop + "]", "[enumerable property: " + prop + "]", parents);
                    }

                    // contract descriptors default to the descriptor on the value unless
                    // explicitly specified by the contrac 
                    this.oc[prop] = {
                        value        : value,
                        writable     : contractDesc.writable || objDesc.writable,
                        configurable : contractDesc.configurable || objDesc.configurable,
                        enumerable   : contractDesc.enumerable || objDesc.enumerable
                    };
                } else { // property does not exist but we have a contract for it
                    if(value.ctype === "opt") { // the opt contract allows a property to be optional
                        this.oc[prop] = {       // so just put in the contract with all the prop descriptors set to true
                            value        : value,
                            writable     : true,
                            configurable : true,
                            enumerable   : true
                        };
                    } else {
                        blame(pos, neg, this, "[missing property: " + prop + "]", parents);
                    }
                }
            }

            // check object invariant
            if(options.invariant) {
                invariant = options.invariant.bind(obj);
                if(!invariant()) {
                    blame(neg, pos, "invariant: " + options.invariant.toString(), obj, parents);
                }
            }

            handler.defineProperty = function(name, desc) {
                // note: we coulad have also allowed a TypeError to be thrown by the system
                // if in strict mode or silengtly fail otherwise but we're using the blame system
                // for hopfully better error messaging
                if((options.extensible === false) || options.sealed || options.frozen) {
                    // have to reverse blame since the client is the one calling defineProperty
                    blame(neg, pos,
                          "[non-extensible object]",
                          "[attempted to change property descriptor of: " + name + "]",
                          parents);
                }
                if(!that.oc[name].configurable) {
                    blame(neg, pos,
                          "[non-configurable property: " + name + "]",
                          "[attempted to change the property descriptor of property: " + name + "]",
                          parents);
                }
                Object.defineProperty(obj, name, desc);
            };
            handler.delete = function(name) {
                var res, invariant;
                if(options.sealed || options.frozen) {
                    // have to reverse blame since the client is the one calling delete
                    blame(neg, pos, (options.sealed ? "sealed" : "frozen") + " object", "[call to delete]", parents);
                }
                res = delete obj[name]; 
                if(options.invariant) {
                    invariant = options.invariant.bind(obj);
                    if(!invariant()) {
                        blame(neg, pos, "invariant: " + options.invariant.toString(), obj, parents);
                    }
                }
            };
            handler.get = function(receiver, name) {
                if(that.oc.hasOwnProperty(name)) { 
                    return that.oc[name].value.check(obj[name], pos, neg, parents);
                } else if ( (options.arrayRangeContract && (options.arrayRange !== undefined))
                            && (parseInt(name, 10) >= options.arrayRange) ) {
                    return options.arrayRangeContract.check(obj[name], pos, neg, parents);
                } else {
                    return obj[name];
                }
            };
            handler.set = function(receiver, name, val) {
                var invariant;

                if( (options.extensible === false) && Object.getOwnPropertyDescriptor(obj, name) === undefined) {
                    blame(neg, pos, "non-extensible object", "[attempted to set a new property: " + name + "]", parents);
                }
                if(options.frozen) {
                    blame(neg, pos, "frozen object", "[attempted to set: " + name + "]", parents);
                }
                if(that.oc.hasOwnProperty(name)) { 
                    if(!that.oc[name].writable) {
                        blame(neg, pos, "read-only property", "[attempted to set read-only property: " + name + "]", parents);
                    }
                    // have to reverse blame since the client is the one calling set
                    obj[name] = that.oc[name].value.check(val, neg, pos, parents);
                } else if ( (options.arrayRangeContract && (options.arrayRange !== undefined))
                            && (parseInt(name, 10) >= options.arrayRange) ) {
                    obj[name] = options.arrayRangeContract.check(val, neg, pos, parents);
                } else {
                    obj[name] = val;
                }
                if(options.invariant) {
                    invariant = options.invariant.bind(obj);
                    if(!invariant()) {
                        blame(neg, pos, "invariant: " + options.invariant.toString(), obj, parents);
                    }
                }
                return true;
            };

            // making this a function proxy if object is also a
            // function to preserve typeof checks
            if (typeof obj === "function") {
                op = Proxy.createFunction(handler,
                                          function(args) {
                                              return obj.apply(this, arguments);
                                          },
                                          function(args) {
                                              var boundArgs, bf;
                                              boundArgs = [].concat.apply([null], arguments);
                                              bf = obj.bind.apply(obj, boundArgs);
                                              return new bf();
                                          });

            } else {
                op = Proxy.create(handler, Object.prototype); 
                // todo: is this the proto we actually want?
            }
            unproxy.set(op, this);
            return op;
        });
        c.oc = objContract;
        c.raw_options = options;

        // hook up the recursive contracts if they exist
        function setSelfContracts(c, toset) {
            var i, name,
                // all the different possible children names from the combinators (really kludgy)
                childrenNames = ["k", "k1", "k2", "flats", "ho", "calldom", "callrng", "newdom", "newrng"];
            // check each of the properties in an object contract
            if(typeof c.oc !== 'undefined') {
                for(name in c.oc) {
                    // if this prop is the self contract replace it with the contract reference
                    if(c.oc[name] === self) {
                        c.oc[name] = toset;
                    // otherwise if it's a function contract then there might be nested
                    // self contracts so dive into them with the original toset reference
                    } else if(c.oc[name].ctype !== "object") {
                        setSelfContracts(c.oc[name], toset);
                    }
                    // note that we don't dive into object contracts...each self contract
                    // thus binds to its enclosing object contract
                }
            } else {
                // run through each of the children contracts (sorry, pretty kludgy)
                childrenNames.forEach(function(cName) {
                    if (typeof c[cName] !== 'undefined') {
                        // the if stored in an array go through those first
                        if(Array.isArray(c[cName])) {
                            for(i = 0; i < c[cName].length; i++) {
                                if(c[cName][i] === self) {
                                    c[cName][i] = toset;
                                } else if(c[cName][i].ctype !== "object") {
                                    // dive into nested contracts with the original toset reference
                                    setSelfContracts(c[cName][i], toset);
                                }
                            } 
                        } else {
                            if(c[cName] === self) {
                                c[cName] = toset;
                            } else if(c[cName] !== "object") {
                                setSelfContracts(c[cName], toset);
                            }

                        }

                    }                     
                });

            }
        }
        setSelfContracts(c, c);


        c.equals = function(other) {
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            return checkOptions(this.oc, other.oc) && checkOptions(this.raw_options, other.raw_options);
        };
        return c;
    };

    // (___(any), () -> Contract) -> Contract
    function arr(ks) {
        // todo might make sens to allow var args along with array arguments
        var i, rangeContract, rangeIndex, oc = {}, name = "", prefix = "";
        for(i = 0; i < ks.length; i++) {
            if (i !== 0)  { prefix = ", "; }
            // assuming that the only possible function is ___()
            if(typeof ks[i] === "function") {
                if(i !== ks.length - 1) {
                    throw "___() must be at the last position in the array";
                }
                rangeContract = ks[i]();
                rangeIndex = i;
                name += prefix + "..." + rangeContract.cname;
            } else {
                oc[i] = ks[i];
                name += prefix + ks[i].cname;
            }
        }
        name = "[" + name + "]";
        return object(oc, {arrayRange: rangeIndex, arrayRangeContract: rangeContract}, name);
    };

    function ___(k) {
        return function() {
            return k;
        };
    };

    var any = (function any() {
        var c = new Contract("any", "any", function(val) {
            return val;
        });
        c.equals = function(other) {
            return this === other;
        };
        return c;
    })();

    var self = (function () {
        var c = new Contract("self", "self", function(val){ return val; });
        c.equals = function(other) {
            return this === other;
        };
        return c;
    })();

    function or() {
        var c, ks, name, flats, ho;
        ks = [].slice.call(arguments);
        flats = ks.filter(function(el) {
            return el.ctype === "check";
        });
        ho = ks.filter(function(el) {
            return el.ctype !== "check";
        });
        if(ho.length > 1) {
            throw "Cannot have more than 1 higher order contract in 'or'";
        }

        name = ks.join(" or ");
        c = new Contract(name, "or",  function(val, pos, neg, parentKs) {
            var i, lastBlame,
                parents = parentKs.slice(0);
            parents.push(this);
            
            for(i = 0; i < flats.length; i++) {
                try {
                    return this.flats[i].check(val, pos, neg, parents);
                } catch (e) {
                    lastBlame = e;
                    continue;
                }
            }
            if(ho.length === 1) {
                return this.ho[0].check(val, pos, neg, parents);
            } else {
                throw lastBlame; // the last contract in the array still assigned blame so surface it
            }
        });

        c.flats = flats;
        c.ho = ho;
        c.equals = function(other) {
            var zipFlats, pFlats;
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            zipFlats = Utils.zip(this.flats, other.flats);
            pFlats = (zipFlats.length !== 0) && zipFlats.every(function(zf) {
                return zf[0].equals(zf[1]);
            });
            return pFlats && (this.ho.equals(other.ho));
        };
        return c;
    };
    
    var none = (function none() {
        var c = new Contract("none", "none",  function(val, pos, neg, parentKs) {
            blame(pos, neg, this, val, parentKs);
        });
        c.equals = function(other) {
            this === other;
        };
        return c;
    })();

    function and(k1, k2) {
        var c;
        c = new Contract(k1.cname + " and " + k2.cname, "and", function(val, pos, neg, parentKs) {
            var k1c = k1.check(val, pos, neg, parentKs);
            return k2.check(k1c, pos, neg, parentKs);
        });
        c.k1 = k1;
        c.k2 = k2;
        c.equals = function(other) {
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            return (this.k1.equals(other.k1)) && (this.k2.equals(other.k2));
        };
        return c;
    };

    function not(k) {
        var c, res;
        if(k.ctype === "fun" || k.ctype === "object") {
            throw "cannot construct a 'not' contract with a function or object contract";
        }
        c = new Contract("not " + k.cname, "not", function(val, pos, neg, parentKs) {
            try {
                res = this.k.check(val, pos, neg, parentKs);
                blame(pos, neg, this, val, parentKs);
            } catch (b) {
                // inverting the original contract so return ok
                return res;
            }
        });
        c.k = k;
        c.equals = function(other) {
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            return this.k.equals(other.k);
        };
        return c;
    };

    function opt(k) {
        var c;
        c = new Contract("opt(" + k.cname + ")", "opt", function(val, pos, neg, parentKs) {
            if(val === undefined) { // unsuplied arguments are just passed through
                return val;
            } else {
                // arg is actually something so check the underlying contract
                return this.k.check(val, pos, neg, parentKs);
            }
        });
        c.k = k;
        c.equals = function(other) {
            if(!other instanceof Contract || other.ctype !== this.ctype) { return false; }
            return this.k.equals(other.k);
        };
        return c;
    };

    // note that this function is particular about where it is called from.
    // it gets the filename/linenum combo from the file that called the
    // function that called getModName (two levels up the stack).
    // () -> ModuleName
    function getModName(isServer) {
        var guardedAt, match, filename, linenum, st = printStackTrace({e: new Error()});
        // in the stacktrace the frame above this one is where we were guarded/used
        guardedAt = st[2];
        // pull out the filename (which will become our module) and line 
        // number (the location in the module where the guard/use occured)
        // stack traces look like: {anonymous}()@file:///Path/to/file.js:4242
        match = /\/([^\/]*):(\d*)[\)]?$/.exec(guardedAt);
        if(match) {
            filename = match[1];
            linenum = match[2];
        } else {
            filename = "unknown"
            linenum = "-1"
        }
        return new ModuleName(filename, linenum, isServer);
    };

    // ModuleName = ?{filename: Str, linenum: Str}
    // RawContract = ?{use: (ModuleName?) -> any}
    // (Contract, any, ModuleName?) -> RawContract
    function guard(k, x, server, setup) {
        var stack = [];
        if(typeof setup === 'function') { setup(stack); }
        if(!server) {
            // if a server wasn't provied, guess if from the stacktrace
            server = getModName(true);
        } else {
            server = new ModuleName(server, "", true);
        }
        return {
            // (ModuleName?) -> any 
            // technically the return is a contracted value but no way to 
            // tell unless the contract is violated
            use: function(client, srvr) {
                // if a client name wasn't provided, guess it from the stacktrace
                if(!client) {
                    client = getModName(false);
                } else {
                    client = new ModuleName(client, "", false);
                }
                if(srvr) {
                    server = new ModuleName(srvr, "", false); 
                }
                // when the user does a guard(...).use() trick we want to
                // disambiguate the server from the client a little nicer
                if( (server.filename === client.filename) && (server.linenum === client.linenum)) {
                    server.linenum = server.linenum + " (server)";
                    client.linenum = client.linenum + " (client)";
                }
                if(enabled) {
                    return k.check(x, server, client, [], stack);                
                } else {
                    return x;                    
                }
            }
        };
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
        not: not,
        and: and,
        opt: opt,
        guard: guard
    };

    // Some basic contracts
    var contracts = {
        Undefined: combinators.check(function(x) {
            return undefined === x;
        }, "Undefined"),
        Null : combinators.check(function(x) {
            return null === x;
        }, "Null"),
        Num: combinators.check(function(x) {
            return typeof(x) === "number";
        }, "Num"),
        Bool: combinators.check(function(x) {
            return typeof(x) === "boolean";
        }, "Bool"),
        Str: combinators.check(function(x) {
            return typeof(x) === "string";
        }, "Str"),
        Odd: combinators.check(function(x) {
            return  (x % 2) === 1;
        }, "Odd"),
        Even: combinators.check(function(x) {
            return (x % 2) !== 1;
        }, "Even"),
        Pos: combinators.check(function(x) {
            return x >= 0;
        }, "Pos"),
        Nat: combinators.check(function(x) {
            return x > 0;
        }, "Nat"),
        Neg: combinators.check(function(x) {
            return x < 0;
        }, "Neg"),
        Arr: combinators.object({
            length: combinators.check(function(x) {
                return typeof(x) === "number";
            }, "Number")
        }),
        Self: self,
        Any: any,
        None: none
    };
    return {
        combinators: combinators,
        contracts: contracts,
        // todo: if we're worried about hostile code will need a better way to enable/disable contracts
        enabled: function(b) { enabled = b; }
    };
})();



