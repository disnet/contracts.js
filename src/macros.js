var _c;
let import = macro {
    rule { @ from $lib:lit } => {
        _c = <%= lib %>
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
        letstx $server = [makeValue("(calling context)", #{here})];
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
