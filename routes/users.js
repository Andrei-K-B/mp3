var User = require('../models/user');
var Task = require('../models/task');
var helper = require('./queryHelper');

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

function serverError(res) {
    send(res, 500, 'Something went wrong on the server.', []);
}

function checkUserBody(body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
        return 'A user must have a name.';
    }
    if (typeof body.email !== 'string' || body.email.trim() === '') {
        return 'A user must have an email.';
    }
    return null;
}

// Checks body.pendingTasks (missing = empty list).
// Returns { status, message } on failure, or { ids, tasks } on success.
async function checkPendingTasks(body) {
    var list = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(list)) {
        return { status: 400, message: 'pendingTasks must be a list of task ids.' };
    }
    for (var i = 0; i < list.length; i++) {
        if (!helper.isValidId(list[i])) {
            return { status: 400, message: 'pendingTasks contains an invalid task id.' };
        }
    }

    // Lowercase and remove duplicates
    var ids = list.map(function (id) { return id.toLowerCase(); });
    ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });

    var tasks = await Task.find({ _id: { $in: ids } });

    // A completed task is a 400, a missing task is a 404 (400s are checked first)
    for (var j = 0; j < tasks.length; j++) {
        if (tasks[j].completed) {
            return { status: 400, message: 'A completed task cannot be in pendingTasks.' };
        }
    }
    if (tasks.length !== ids.length) {
        return { status: 404, message: 'One of the tasks in pendingTasks does not exist.' };
    }

    return { ids: ids, tasks: tasks };
}

// Update the tasks after a user was saved.
// oldIds = the user's previous pendingTasks, newIds = the new list.
async function syncTasks(user, oldIds, newIds, tasks) {
    var userId = user._id.toString();

    // Tasks dropped from the list become unassigned
    var removed = oldIds.filter(function (id) { return newIds.indexOf(id) === -1; });
    await Task.updateMany(
        { _id: { $in: removed }, assignedUser: userId },
        { assignedUser: '', assignedUserName: 'unassigned' }
    );

    // Tasks taken from another user are removed from that user's list
    for (var i = 0; i < tasks.length; i++) {
        var other = tasks[i].assignedUser;
        if (other !== '' && other !== userId && helper.isValidId(other)) {
            await User.updateOne({ _id: other }, { $pull: { pendingTasks: tasks[i]._id.toString() } });
        }
    }

    // Every task in the new list is assigned to this user
    await Task.updateMany(
        { _id: { $in: newIds } },
        { assignedUser: userId, assignedUserName: user.name }
    );

    // Keep the name up to date on all of this user's tasks (completed ones too)
    await Task.updateMany({ assignedUser: userId }, { assignedUserName: user.name });
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    // GET /users
    usersRoute.get(async function (req, res) {
        try {
            var users = await helper.getList(User, req.query, undefined);
            send(res, 200, 'OK', users);
        } catch (err) {
            helper.sendQueryError(res, err);
        }
    });

    // POST /users
    usersRoute.post(async function (req, res) {
        try {
            var body = req.body || {};
            var problem = checkUserBody(body);
            if (problem) return send(res, 400, problem, []);

            var existing = await User.findOne({ email: body.email });
            if (existing) return send(res, 400, 'A user with that email already exists.', []);

            var check = await checkPendingTasks(body);
            if (check.status) return send(res, check.status, check.message, []);

            var user = await User.create({ name: body.name, email: body.email, pendingTasks: check.ids });
            await syncTasks(user, [], check.ids, check.tasks);
            send(res, 201, 'User created', user);
        } catch (err) {
            serverError(res);
        }
    });

    // GET /users/:id
    userRoute.get(async function (req, res) {
        try {
            var user = await helper.getOne(User, req.params.id, req.query);
            if (!user) return send(res, 404, 'User not found.', []);
            send(res, 200, 'OK', user);
        } catch (err) {
            helper.sendQueryError(res, err);
        }
    });

    // PUT /users/:id
    userRoute.put(async function (req, res) {
        try {
            // 1. URL id -> 404
            if (!helper.isValidId(req.params.id)) return send(res, 404, 'User not found.', []);
            var user = await User.findById(req.params.id);
            if (!user) return send(res, 404, 'User not found.', []);

            // 2. Field values -> 400
            var body = req.body || {};
            var problem = checkUserBody(body);
            if (problem) return send(res, 400, problem, []);

            var other = await User.findOne({ email: body.email, _id: { $ne: user._id } });
            if (other) return send(res, 400, 'A user with that email already exists.', []);

            // 3. pendingTasks -> 400 or 404
            var check = await checkPendingTasks(body);
            if (check.status) return send(res, check.status, check.message, []);

            // 4. Replace (dateCreated is left alone) and sync the tasks
            var oldIds = user.pendingTasks.slice();
            user.name = body.name;
            user.email = body.email;
            user.pendingTasks = check.ids;
            await user.save();
            await syncTasks(user, oldIds, check.ids, check.tasks);
            send(res, 200, 'User updated', user);
        } catch (err) {
            serverError(res);
        }
    });

    // DELETE /users/:id
    userRoute.delete(async function (req, res) {
        try {
            if (!helper.isValidId(req.params.id)) return send(res, 404, 'User not found.', []);
            var user = await User.findByIdAndDelete(req.params.id);
            if (!user) return send(res, 404, 'User not found.', []);

            // Unassign all of the user's tasks (completed ones too)
            await Task.updateMany(
                { assignedUser: user._id.toString() },
                { assignedUser: '', assignedUserName: 'unassigned' }
            );
            res.status(204).send();
        } catch (err) {
            serverError(res);
        }
    });

    return router;
};