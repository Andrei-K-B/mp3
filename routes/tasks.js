var Task = require('../models/task');
var User = require('../models/user');
var helper = require('./queryHelper');

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

function serverError(res) {
    send(res, 500, 'Something went wrong on the server.', []);
}

// check body and build the fields
function parseTask(body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
        return { error: 'A task must have a name.' };
    }

    var deadlineOk = (typeof body.deadline === 'string' && body.deadline.trim() !== '') ||
                     typeof body.deadline === 'number';
    if (!deadlineOk || isNaN(new Date(body.deadline).getTime())) {
        return { error: 'A task must have a valid deadline.' };
    }

    var description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string') {
        return { error: 'The description must be text.' };
    }

    var completed = body.completed === undefined ? false : body.completed;
    if (completed === 'true') completed = true;
    if (completed === 'false') completed = false;
    if (typeof completed !== 'boolean') {
        return { error: 'The completed field must be true or false.' };
    }

    var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (typeof assignedUser !== 'string') {
        return { error: 'The assignedUser field must be text.' };
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        return { error: 'The assignedUserName field must be text.' };
    }

    return {
        fields: {
            name: body.name,
            description: description,
            deadline: new Date(body.deadline),
            completed: completed,
            assignedUser: assignedUser,
            assignedUserName: assignedUserName
        }
    };
}

// Checks assignedUser / assignedUserName and fill in the name.

async function checkAssignment(fields) {

    if (fields.assignedUser === '') {
        var n = fields.assignedUserName;
        if (n !== undefined && n !== '' && n !== 'unassigned') {
            return { status: 400, message: 'assignedUserName must be "unassigned" when no user is assigned.' };
        }
        fields.assignedUserName = 'unassigned';
        return null;
    }

    if (!helper.isValidId(fields.assignedUser)) {
        return { status: 400, message: 'assignedUser is not a valid user id.' };
    }

    var user = await User.findById(fields.assignedUser);
    if (!user) {
        return { status: 404, message: 'The assigned user does not exist.' };
    }

    if (fields.assignedUserName === undefined) {
        fields.assignedUserName = user.name;
    } else if (fields.assignedUserName !== user.name) {
        return { status: 400, message: 'assignedUserName does not match the name of the assigned user.' };
    }

    fields.assignedUser = user._id.toString();
    return null;
}

// Update pendingTasks lists fter a task is saved.
// oldUserId is who the task was assigned to before 
async function updateUserLists(task, oldUserId) {
    var taskId = task._id.toString();

    // task moved from the old User
    if (oldUserId && oldUserId !== task.assignedUser && helper.isValidId(oldUserId)) {
        await User.updateOne({ _id: oldUserId }, { $pull: { pendingTasks: taskId } });
    }

    // pending tasks go in the list, completed tasks come out
    if (task.assignedUser !== '') {
        if (task.completed) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: taskId } });
        } else {
            await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } });
        }
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    // GET /tasks
    tasksRoute.get(async function (req, res) {
        try {
            var tasks = await helper.getList(Task, req.query, 100);
            send(res, 200, 'OK', tasks);
        } catch (err) {
            helper.sendQueryError(res, err);
        }
    });

    // POST /tasks
    tasksRoute.post(async function (req, res) {
        try {
            var result = parseTask(req.body || {});
            if (result.error) return send(res, 400, result.error, []);

            var problem = await checkAssignment(result.fields);
            if (problem) return send(res, problem.status, problem.message, []);

            var task = await Task.create(result.fields);
            await updateUserLists(task, '');
            send(res, 201, 'Task created', task);
        } catch (err) {
            serverError(res);
        }
    });

    // GET /tasks/:id
    taskRoute.get(async function (req, res) {
        try {
            var task = await helper.getOne(Task, req.params.id, req.query);
            if (!task) return send(res, 404, 'Task not found.', []);
            send(res, 200, 'OK', task);
        } catch (err) {
            helper.sendQueryError(res, err);
        }
    });

    // PUT /tasks/:id
    taskRoute.put(async function (req, res) {
        try {

            if (!helper.isValidId(req.params.id)) return send(res, 404, 'Task not found.', []);
            var task = await Task.findById(req.params.id);
            if (!task) return send(res, 404, 'Task not found.', []);

            var result = parseTask(req.body || {});
            if (result.error) return send(res, 400, result.error, []);

            var problem = await checkAssignment(result.fields);
            if (problem) return send(res, problem.status, problem.message, []);

            var oldUserId = task.assignedUser;
            task.set(result.fields);
            await task.save();
            await updateUserLists(task, oldUserId);
            send(res, 200, 'Task updated', task);
        } catch (err) {
            serverError(res);
        }
    });

    // DELETE /tasks/:id
    taskRoute.delete(async function (req, res) {
        try {
            if (!helper.isValidId(req.params.id)) return send(res, 404, 'Task not found.', []);
            var task = await Task.findByIdAndDelete(req.params.id);
            if (!task) return send(res, 404, 'Task not found.', []);

            // rmove from assigned user's pendingTasks
            if (task.assignedUser !== '' && helper.isValidId(task.assignedUser)) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task._id.toString() } });
            }
            send(res, 200, 'Task deleted', task);
        } catch (err) {
            serverError(res);
        }
    });

    return router;
};