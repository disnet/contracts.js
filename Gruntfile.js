/*global module:false*/
module.exports = function(grunt) {

    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-sweet.js');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-template');


    // Project configuration.
    grunt.initConfig({
        // Task configuration.
        sweetjs: {
            contracts: {
                options: {
                    modules: ["sparkler/macros", "es6-macros"]
                },
                src: "src/contracts.js",
                dest: "build/contracts.js"
            },
            tests: {
                options: {
                    modules: ["./macros/index.js"]
                },
                src: "test/test_contracts.js",
                dest: "build/tests/test_contracts.js"
            }
        },
        template: {
            macros: {
                options: {
                    data: function() {
                        return {
                            lib: grunt.file.read("build/contracts.js")
                        };
                    }
                },
                src: "src/macros.js",
                dest: "macros/index.js"
            }
        },
        jshint: {
            options: {
                curly: true,
                eqeqeq: true,
                immed: true,
                latedef: true,
                newcap: true,
                noarg: true,
                sub: true,
                undef: true,
                unused: true,
                boss: true,
                eqnull: true,
                globals: {
                    jQuery: true
                }
            },
            gruntfile: {
                src: 'Gruntfile.js'
            },
            lib_test: {
                src: ['contracts.js', 'test/**/*.js']
            }
        },
        mochaTest: {
            contracts: {
                src: ["build/tests/*.js"]
            }
        },
        watch: {
            scripts: {
                files: ["src/*", "test/*"],
                tasks: ["sweetjs:contracts", "template", "sweetjs:tests", "mochaTest"]
            }
        }
    });


    // Default task.
    grunt.registerTask('default', ["sweetjs:contracts", "template", "sweetjs:tests", "mochaTest"]);

};
