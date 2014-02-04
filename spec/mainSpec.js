var nano = require('nano');

//load the module under test.
var ektorp = require('../lib/index.js');

//async timeout will be a half-second.
var HALF_SECOND = 500;
var TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT || HALF_SECOND);

console.info("Test timeout is set to: " + TEST_TIMEOUT + "ms");

describe("Migration function", function(){
	_baseconn = nano("http://localhost:5984/");
	_dbname = null;
	_conn = null;

	//create a test database in which to push migrations.
	beforeEach(function(done){
		_dbname = "couch_migrations_tests_" + 
			new Date().getTime() + "_" + Math.floor(Math.random() * 10000);

		_baseconn.db.create(_dbname, function(err){
			if(err){
				throw "Couldn't create test db: " + _dbname;
			}else{
				_conn = _baseconn.use(_dbname);
				done();
			}
		});
	}, TEST_TIMEOUT);

	//destroy the test database.
	afterEach(function(done){
		_baseconn.db.destroy(_dbname, function(err){
			if(err){
				throw "Couldn't destroy test db: " + _dbname;
			}else{
				done();
			}
		});
	}, TEST_TIMEOUT);


	it("applies object-based migration.", function(done) {
		//generate a "random" id.
		var id = new Date().toString();

		var migrator = ektorp(_conn, {label : 1, docs : { _id : id}});
		migrator.on('done', function(){
			_conn.get(id, function(err, result){
				expect(result._rev).not.toBeNull();
				expect(result._id).toEqual(id);
				done();
			});
		});
		migrator.start();
	}, TEST_TIMEOUT);
	
	it("applies array-based migration", function(done){
		var testid1 = "testid1";
		var testid2 = "testid2";
		
		var migrator = ektorp(_conn, {label: 1, docs : [ 
			{ _id : testid2 },{_id : testid1 }
		]});

		migrator.on('done', function(){
			_conn.list({keys : [testid1, testid2]}, function(err, result){
				expect(result.rows.length).toEqual(2);
				done();
			});
		});
		migrator.start();

	}, TEST_TIMEOUT);

	it("fails when no document is provided.", function(done) {
		var migrator = ektorp(_conn, {label: 1, docs : null});

		migrator.on('error', function(err){
			expect(err.message).toEqual('Migrations must provide an array of docs, an object, '+
										'or function that produces an array or object.');
			done();
		});

		migrator.start();
	}, TEST_TIMEOUT);
	
	it("applies function-based migration.", function(done) {
		var id = 'text1234';

		var appliedSpy = jasmine.createSpy();
		var migrator = ektorp(_conn, [{label: 1, docs : function(){
			appliedSpy();
			return { _id : id};
		}}]);
	
		migrator.on('done', function(){
			expect(appliedSpy.callCount).toEqual(1);
			_conn.get(id, function(err, result){
				expect(result._id).toEqual(id);
				done();
			});
		});

		migrator.start();
	}, TEST_TIMEOUT);

	it("halts migrations when an exception is thrown from a migration.", function(done){
		var errorMessage = 'Function failed to get docs.';
		var migrator = ektorp(_conn, [{
								label: 1,
								docs : []
							}, 
							{
								label : 2,
								docs : function(){ throw errorMessage; }
							}] );
		
		migrator.on('error', function(err){
			expect(err).not.toBeNull();
			expect(err).toEqual("Function failed to get docs.");
			done();
		});

		migrator.start();
	}, TEST_TIMEOUT);


	it("creates a '_design/migrations' document to store information on a database.", function(done){

		var migrator = ektorp(_conn, [{label: "1", docs : []},{ label: 2, docs : []}]);

		migrator.on('done', function(){
			_conn.get('_design/migrations',{include_docs : true}, function(err,result){
				expect(result).not.toBeNull();
				expect(result.applied_migrations.length).toEqual(2);
				done();
			});
		});

		done();
	}, TEST_TIMEOUT);


	it("parses version from file name.", function(done){
		var versions = [201401261512,201401261513];
		var migrator = ektorp(_conn, __dirname + '/testMigrations');
		
		migrator.on('applied', function(label){
					expect(label).toEqual(versions.shift());
				})
				.on('done', function(){
					done();
				});

		migrator.start();

	}, TEST_TIMEOUT);

	it("loads an array of migrations based on a file path.", function(done){
		var appliedSpy = jasmine.createSpy();
		var migrator = ektorp(_conn, __dirname + '/testMigrations');

		migrator.on('applied',appliedSpy)
				.on('done', function(){
					expect(appliedSpy.callCount).toEqual(2);
					done();
				});

		migrator.start();
	}, TEST_TIMEOUT);

	it("runs an array of migrations passed as second argument.", function(done){
		var appliedSpy = jasmine.createSpy();

		var migrator = ektorp(_conn, [{label: "1", docs : []},{ label: 2, docs : []}]);

		migrator.on('applied',appliedSpy)
				.on('done', function(){
					expect(appliedSpy.callCount).toEqual(2);
					done();
			});

		done();
	}, TEST_TIMEOUT);

	it("returns event emitter.", function(){
		var migrator = ektorp(_conn, []);
		var EventEmitter = require('events').EventEmitter;
		expect(migrator instanceof EventEmitter).toBe(true);
	});

	it("provides a reference to the database for function-based migrations.", function(done){
		
		var migrationFunction = function(db){
			expect(db.config.db).toEqual(_dbname);
			done();
		};

		var migrator = ektorp(_conn, {label : 1, docs : migrationFunction});
		migrator.start();

	}, TEST_TIMEOUT);

	it("provides a callback when function-based migrations have an arity of two.", function(done){
		
		var migrationFunction = function(connection, callback){
			expect(callback).not.toBeUndefined();
			done();
		};
		var migrator = ektorp(_conn, {label : 1, docs : migrationFunction});
		migrator.start();

	}, TEST_TIMEOUT);

	it("skips migrations that have already been applied.", function(done){
		var migrations = [{ label : 1, docs : []}, {label : 2, docs : []}];
		var migrator = ektorp(_conn, migrations);

		migrator.on('done', function(){
			var m2 = ektorp(_conn, migrations);
			var skipSpy = jasmine.createSpy();
			m2.on('skipped', skipSpy)
				.on('done', function(){
					expect(skipSpy.callCount).toBe(2);
					expect(skipSpy).toHaveBeenCalledWith(1);
					expect(skipSpy).toHaveBeenCalledWith(2);
					done();
				});
			m2.start();
		});

		migrator.start();

	}, TEST_TIMEOUT);

	xit("updates existing documents", function(done){

	}, TEST_TIMEOUT);

	xit("skips migration when it would not modify target document", function(done){

	}, TEST_TIMEOUT);
});