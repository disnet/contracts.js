var _c;
let import = macro {
    rule { @ from $lib:lit } => {
        _c = (function () {
    if (typeof require === 'function') {
        // importing patches Proxy to be in line with the new direct proxies
        require('harmony-reflect');
    }
    function assert(cond, msg) {
        if (!cond) {
            throw new Error(msg);
        }
    }
    var unproxy = new WeakMap();
    function Contract(name, type, handler) {
        this.name = name;
        this.type = type;
        this.handler = handler;
        this.parent = null;
    }
    Contract.prototype.check = function check$2(val, pos, neg, parents) {
        return this.handler(val, pos, neg, parents ? parents : []);
    };
    Contract.prototype.toString = function toString() {
        return this.name;
    };
    function blame(toblame, other, contract, value, parents) {
        var promisedContract;
        var msg = toblame + ': broke its contract\n' + 'promised: ' + contract + '\n' + 'produced: ' + value + '\n' + 'which is not: ' + contract + '\n' + 'in: ' + other + '\n' + 'blaming: ' + toblame;
        var e = new Error(msg);
        throw e;
    }
    function check(predicate, name) {
        var c = new Contract(name, 'check', function (val, pos, neg, parents) {
                if (predicate(val)) {
                    return val;
                } else {
                    return blame(pos, neg, this, val, parents);
                }
            });
        return c;
    }
    return {
        Num: check(function (val) {
            return typeof val === 'number';
        }),
        fun: function (dom, rng, options) {
            var domName = '(' + dom.join(',') + ')';
            var contractName = domName + ' -> ' + rng.name;
            var c = new Contract(contractName, 'fun', function (f, pos, neg, parents) {
                    if (typeof f !== 'function') {
                        blame(pos, neg, this, f, parents);
                    }
                    parents.push(this);
                    /* options:
                   pre: ({} -> Bool) - function to check preconditions
                   post: ({} -> Bool) - function to check postconditions
                   this: {...} - object contract to check 'this'
                */
                    function applyTrap(target, thisVal, args) {
                        var checkedArgs = args.map(function (arg, i) {
                                return dom[i] ? dom[i].check(arg, neg, pos, parents) : arg;
                            });
                        assert(rng instanceof Contract, 'The range is not a contract');
                        return rng.check(target.apply(thisVal, checkedArgs), pos, neg, parents);
                    }
                    p = new Proxy(f, { apply: applyTrap });
                    unproxy.set(p, this);
                    return p;
                });
            return c;
        }
    };
}());
    }
    rule { $rest ... } => {
        import $rest ...
    }
}
export import;

macro toLibrary {
    rule { {
		($args ...) -> $rest ...
	} } => {
        _c.fun(
            [toLibrary { $args ... }],
             toLibrary {$rest ...})
	}

    rule { {
        { $($key : $contract) (,) ... }
    } } => {
        _c.object({
            $($key : toLibrary { $contract }) (,) ...
        })

    }

    rule { {
		$contract , $rest ...
	} } => {
        toLibrary { $contract } , toLibrary { $rest ... }
	}

    rule { {
		$contract
	} } => {
        _c.$contract
	}
}

let @ = macro {
	case {_
        $contracts ...
		function $name ($params ...) { $body ...}
    } => {
        var nameStr = unwrapSyntax(#{$name});
        letstx $guardedName = [makeIdent("inner_" + nameStr, #{here})];
        letstx $client = [makeValue("function " + nameStr, #{here})];
        letstx $server = [makeValue(filename, #{here})];
		return #{
            var $guardedName = (toLibrary { $contracts ... }).check(
                function $name ($params ...) { $body ...},
                $client,
                $server);
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
	}
}
export @;
