var mongoose = require('mongoose');

// Make an error with 400 status
function badRequest(message) {
    var err = new Error(message);
    err.status = 400;
    return err;
}

// regex for valid string 24 characters long with only allowed characters
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse a JSON query parameter like where / sort / select.
// Returns undefined if the parameter was not given.
function parseJSON(value, name) {
    if (value === undefined) return undefined;
    var parsed;
    try {
        parsed = JSON.parse(value);
    } catch (e) {
        throw badRequest('The "' + name + '" parameter is not valid JSON.');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw badRequest('The "' + name + '" parameter must be a JSON object.');
    }
    return parsed;
}

function parseNumber(value, name) {
    if (value === undefined) return undefined;
    var n = Number(value);
    if (typeof value !== 'string' || value.trim() === '' || !Number.isInteger(n) || n < 0) {
        throw badRequest('The "' + name + '" parameter must be a non-negative whole number.');
    }
    return n;
}

// build the query for GET /users or GET /tasks.
// Returns a Mongoose query
// defaultLimit: 100 for tasks, undefined for users.
function getList(Model, params, defaultLimit) {
    var where = parseJSON(params.where, 'where') || {};
    var sort = parseJSON(params.sort, 'sort');
    var select = parseJSON(params.select, 'select');
    var skip = parseNumber(params.skip, 'skip');
    var limit = parseNumber(params.limit, 'limit');
    if (limit === undefined) limit = defaultLimit;

    // count=true returns just the number of matching documents
    if (String(params.count).toLowerCase() === 'true') {
        return Model.countDocuments(where);
    }

    var query = Model.find(where);
    if (sort) query = query.sort(sort);
    if (select) query = query.select(select);
    if (skip !== undefined) query = query.skip(skip);
    if (limit !== undefined) query = query.limit(limit);
    return query;
}

// makes the query for GET /users/:id or GET /tasks/:id.
function getOne(Model, id, params) {
    if (!isValidId(id)) return Promise.resolve(null);
    var query = Model.findById(id);
    var select = parseJSON(params.select, 'select');
    if (select) query = query.select(select);
    return query;
}

function sendQueryError(res, err) {
    if (err.status === 400) {
        return res.status(400).json({ message: err.message, data: [] });
    }

    if (err.name === 'CastError' || err.name === 'MongoServerError') {
        return res.status(400).json({ message: 'One of the query parameters has an invalid value.', data: [] });
    }
    return res.status(500).json({ message: 'Something went wrong on the server.', data: [] });
}

module.exports = {
    isValidId: isValidId,
    getList: getList,
    getOne: getOne,
    sendQueryError: sendQueryError
};